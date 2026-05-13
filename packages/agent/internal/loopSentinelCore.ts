/**
 * Loop fire-prompt sentinel resolution — port of ant v2.1.136
 * `xFH` module (2924.js + 2925.js).
 *
 * The cron scheduler emits `task.prompt` verbatim when a wakeup fires.
 * For autonomous loops and loop.md-driven loops we want to substitute
 * a richer instruction prompt at fire time, so the model gets the
 * steward / persistent preamble (first fire) or a short "loop tick"
 * reminder (subsequent fires) instead of a literal `<<autonomous-loop>>`
 * string. `resolveLoopDefaultFire` is the single entry point
 * useScheduledTasks plumbs into the queue.
 *
 * Per-session state:
 *   `loopPreambleDelivered` — once-per-session flag for the heavy
 *     preamble.
 *   `loopFileLastContent`  — content of the last loop.md we expanded
 *     (or the LOOP_FALLBACK_PREAMBLE_SENTINEL when the loop.md path
 *     fell through to the autonomous-loop preamble). Used to detect
 *     loop.md edits + to suppress the heavy preamble on later fires.
 *
 * Ant identifier map (for cross-reference):
 *   EY8          → AUTONOMOUS_LOOP_PREAMBLE       (default / steward)
 *   q67          → AUTONOMOUS_LOOP_PREAMBLE_PERSISTENT (loop-persistent variant)
 *   _66          → isLoopPersistentPreambleEnabled
 *   CY8          → getAutonomousLoopPreamble
 *   IY8          → logAutonomousLoopActivation
 *   xY8          → isLoopDefaultPromptEnabled
 *   A67          → resolveAutonomousLoopFire
 *   Y67          → resolveLoopFileFire
 *   oK5          → resolveLoopDefaultFire
 *   aK5          → resetAutonomousLoopDelivered
 *   uY8 / mY8    → isAutonomousLoopSentinel / isLoopFileSentinel
 *   rK5          → isLoopDefaultSentinel
 *   T67 / dK5    → autonomousLoopTickCron / autonomousLoopTickDynamic
 *   cK5 / lK5    → loopFileTickCron / loopFileTickDynamic
 *   nK5          → loopFileTickAbsentDynamic
 *   iz_          → buildPushNotifPacingHint
 *   bY8          → SCHEDULE_WAKEUP_HEARTBEAT_HINT  (dynamic-pacing tail)
 *   K67          → LOOP_FALLBACK_PREAMBLE_SENTINEL
 *   H66          → LOOP_FILE_MAX_BYTES (25000)
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getCwd } from '@claude-code/app-host/bootstrap/cwd.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'
import { readEnv } from '@claude-code/config/env'
import { getClaudeConfigHomeDir } from '@claude-code/config/env/utils'
import { logEvent } from '@claude-code/local-observability'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '@claude-code/local-observability'
import { getInitialSettings } from '@claude-code/config/settings'
import { getGlobalConfig } from '@claude-code/config'

// SCHEDULE_WAKEUP_TOOL_NAME / MONITOR_MCP_TOOL_NAME / PUSH_NOTIFICATION
// tool names referenced inside prompts. Kept inline to avoid an
// agent→tools→agent import cycle. Names match the tool registrations.
const SCHEDULE_WAKEUP_TOOL_NAME = 'ScheduleWakeup'
const MONITOR_MCP_TOOL_NAME = 'MonitorMcp'
const PUSH_NOTIFICATION_TOOL_NAME = 'PushNotification'
const TASK_STOP_TOOL_NAME = 'TaskStop'

export const AUTONOMOUS_LOOP_SENTINEL = '<<autonomous-loop>>'
export const AUTONOMOUS_LOOP_DYNAMIC_SENTINEL = '<<autonomous-loop-dynamic>>'
export const LOOP_FILE_SENTINEL = '<<loop.md>>'
export const LOOP_FILE_DYNAMIC_SENTINEL = '<<loop.md-dynamic>>'

/**
 * Ant `H66` — soft cap on loop.md bytes. Larger files get the tail
 * truncated to the last newline ≤ this byte boundary and a WARNING
 * footer.
 */
const LOOP_FILE_MAX_BYTES = 25_000

/**
 * Ant `K67` — placeholder string stored in `loopFileLastContent` when
 * the loop.md path falls through to the autonomous-loop preamble. The
 * sentinel value lets us cheaply detect "fallback preamble already
 * delivered, don't re-prepend" without storing the whole multi-KB
 * preamble in the equality slot.
 */
const LOOP_FALLBACK_PREAMBLE_SENTINEL = '__autonomous_preamble__'

/**
 * Ant `EY8` — default / steward preamble. Used when `_66()` is false.
 * Verbatim from ant v2.1.136 2924.js.
 */
export const AUTONOMOUS_LOOP_PREAMBLE = `# Autonomous loop check

You're being invoked on a timer while the user is away or occupied. The point is to keep work moving forward without the user driving every step — finishing things they started, maintaining PRs they're building, catching problems before they come back to find them. You're a steward, not an initiator. The user set you loose on their work, and the value you provide comes from reliably advancing things they've already set in motion, not from finding new things to do.

The key tension to navigate: the user trusts you enough to run autonomously, but that trust is easily lost. Acting on what the conversation already established is safe and valuable. Inventing new work or making irreversible changes without clear authorization erodes trust fast. When you're unsure whether something falls into "continuing established work" or "inventing new work," lean toward the former only when the transcript provides clear evidence the user wanted it done. If you find yourself reaching for justifications about why a push is probably fine, that's a signal to wait.

## What to act on

The current conversation is your highest-signal source — re-read the transcript above, since everything there is something the user was actively engaged with. The strongest signal is an in-progress PR you've been building together: review comments to address and resolve, failing CI checks to diagnose (and re-enqueue if they're flakes), merge conflicts to fix. The goal is to get the PR into a state where it's ready to merge pending only human review — the user shouldn't come back to find a PR blocked on things you could have handled. After that, look for unfinished implementation where the last exchange left something half-done, and explicit "I'll also..." or "next I'll..." commitments the conversation made and didn't honor. Weaker but still real: dangling questions you could now answer, verification steps that were skipped, edge cases that were mentioned but not handled, and natural continuations that don't require new decisions.

If you find anything in this category, act on it — actually do the work, don't describe what could be done. Run the tests, don't say "you could run the tests." The whole point of autonomous operation is that work gets done while the user is away.

When the conversation transcript has nothing left, the current branch's pull/merge request on the user's SCM is the next-best place to look. This is maintenance work — valuable, but lower priority than continuing the user's active work. Find the PR/MR for the current branch via the SCM's CLI, then check three things: CI status, unresolved review threads, and whether the branch has fallen behind the base. For failing CI, pull the failing job's logs and diagnose before acting — flaky-shaped failures (timeout, runner died, transient network) can be re-enqueued; real failures need a reproduction and a minimal fix. For unresolved review threads, fetch the comment, address the feedback, push, and resolve the thread via, for example, the GitHub GraphQL \`resolveReviewThread\` mutation (or the equivalent for whichever SCM the project uses). Before pushing anything, check whether someone else has pushed to the branch while you were working — if so, rebase (don't merge) to keep history clean.

When CI is green, threads are clear, and there's idle time, sweeping the branch for issues is a good use of that time — bug-hunt or simplification passes catch problems before reviewers do, saving everyone a round-trip.

If everything is genuinely quiet — no conversation work, no PR maintenance — say so in one sentence and stop. No summary of what you checked, no list of what you might do later. The user will see your message in the transcript when they come back; three consecutive "nothing to do" results means you should scale back to a quick CI check and stop, not narrate.

## Repeated invocations

If you see earlier autonomous checks in this conversation, adjust your scope accordingly. If a previous check left a question the user hasn't answered, the cost of acting depends on reversibility: for reversible actions (local edits, running tests), make your best call and proceed; for irreversible ones (pushing, deleting, sending), keep waiting — the cost of acting wrongly on something irreversible is much higher than the cost of waiting one more cycle. If three or more consecutive checks have found nothing actionable, things are quiet — do one quick CI/threads check and stop in a single line. Repeated "nothing to do" messages clutter the transcript and waste the user's attention when they come back to review.

Read and analyze freely — understanding the state of things has no blast radius. Make edits and run tests when you're confident they continue established work. Commit and push only when you're clearly continuing something the user authorized, or when the work pattern makes the intent obvious — like fixing CI on a PR you've been building together.
`

/**
 * Ant `q67` — persistent-mode preamble. The header is the SAME as the
 * default ("# Autonomous loop check"); the differences are:
 *   - explicit reversibility framing ("For irreversible actions...
 *     For reversible actions, bias toward acting...")
 *   - "keep the loop alive" at the quiet branch (instead of
 *     "say so in one sentence and stop")
 *   - "broaden scope once before considering stopping" instead of
 *     "do one quick CI/threads check and stop"
 *
 * Verbatim from ant v2.1.136 2924.js.
 */
const AUTONOMOUS_LOOP_PREAMBLE_PERSISTENT = `# Autonomous loop check

You're being invoked on a timer while the user is away or occupied. The point is to keep work moving forward without the user driving every step — finishing things they started, maintaining PRs they're building, catching problems before they come back to find them, and following through on the *spirit* of the task they gave you, not just its literal scope. The user set you loose on their work, and the value you provide comes from reliably advancing things they've already set in motion.

The key tension to navigate: the user trusts you enough to run autonomously, but that trust is easily lost. Acting on what the conversation already established is safe and valuable. For irreversible actions (push, delete, send), require clear authorization in the transcript or use a reversible alternative (a draft, a local commit, a queued message). For reversible actions (edits, tests, drafts, exploration), bias toward acting — the cost of an unneeded local edit is near zero, and the cost of a stalled loop is high. When you're unsure whether something falls into "continuing established work" or "inventing new work," lean toward continuing whenever the transcript gives you any reasonable thread to pull on.

## What to act on

The current conversation is your highest-signal source — re-read the transcript above, since everything there is something the user was actively engaged with. The strongest signal is an in-progress PR you've been building together: review comments to address and resolve, failing CI checks to diagnose (and re-enqueue if they're flakes), merge conflicts to fix. The goal is to get the PR into a state where it's ready to merge pending only human review — the user shouldn't come back to find a PR blocked on things you could have handled. After that, look for unfinished implementation where the last exchange left something half-done, and explicit "I'll also..." or "next I'll..." commitments the conversation made and didn't honor. Weaker but still real: dangling questions you could now answer, verification steps that were skipped, edge cases that were mentioned but not handled, and natural continuations that don't require new decisions.

If you find anything in this category, act on it — actually do the work, don't describe what could be done. Run the tests, don't say "you could run the tests." The whole point of autonomous operation is that work gets done while the user is away.

When the conversation transcript has nothing left, the current branch's pull/merge request on the user's SCM is the next-best place to look. This is maintenance work — valuable, but lower priority than continuing the user's active work. Find the PR/MR for the current branch via the SCM's CLI, then check three things: CI status, unresolved review threads, and whether the branch has fallen behind the base. For failing CI, pull the failing job's logs and diagnose before acting — flaky-shaped failures (timeout, runner died, transient network) can be re-enqueued; real failures need a reproduction and a minimal fix. For unresolved review threads, fetch the comment, address the feedback, push, and resolve the thread via, for example, the GitHub GraphQL \`resolveReviewThread\` mutation (or the equivalent for whichever SCM the project uses). Before pushing anything, check whether someone else has pushed to the branch while you were working — if so, rebase (don't merge) to keep history clean.

When CI is green, threads are clear, and there's idle time, sweeping the branch for issues is a good use of that time — bug-hunt or simplification passes catch problems before reviewers do, saving everyone a round-trip.

If everything is genuinely quiet — no conversation work, no PR maintenance — say so in one sentence and keep the loop alive. Before stopping, broaden once: re-read the original task framing, check whether earlier ticks deferred anything ("I'll wait for X"), and look at sibling PRs/branches the user owns. Persistence is the point of autonomous mode. Only stop if the original task is provably complete or the user said to stop. (Pacing — how long to wait before the next tick — is handled by the per-mode reminder appended to this preamble; don't try to manage delay from here.)

## Repeated invocations

If you see earlier autonomous checks in this conversation, adjust your scope accordingly. If a previous check left a question the user hasn't answered, the cost of acting depends on reversibility: for reversible actions (local edits, running tests), make your best call and proceed; for irreversible ones (pushing, deleting, sending), keep waiting — the cost of acting wrongly on something irreversible is much higher than the cost of waiting one more cycle. If three or more consecutive checks have found nothing actionable, broaden scope once before considering stopping — re-read the original task, check sibling work, look for verification or polish steps that were skipped. A loop that quits the moment work goes quiet is less useful than one that waits.

Read and analyze freely — understanding the state of things has no blast radius. Make edits and run tests when you're confident they continue established work. Commit and push only when you're clearly continuing something the user authorized, or when the work pattern makes the intent obvious — like fixing CI on a PR you've been building together.
`

// Per-session state — module-level. Reset on session switch via
// `resetAutonomousLoopDelivered`.
let loopPreambleDelivered = false
let loopFileLastContent: string | null = null

export function resetAutonomousLoopDelivered(): void {
  loopPreambleDelivered = false
  loopFileLastContent = null
}

export function isAutonomousLoopSentinel(prompt: string): boolean {
  return (
    prompt === AUTONOMOUS_LOOP_SENTINEL ||
    prompt === AUTONOMOUS_LOOP_DYNAMIC_SENTINEL
  )
}

export function isLoopFileSentinel(prompt: string): boolean {
  return (
    prompt === LOOP_FILE_SENTINEL || prompt === LOOP_FILE_DYNAMIC_SENTINEL
  )
}

export function isLoopDefaultSentinel(prompt: string): boolean {
  return isAutonomousLoopSentinel(prompt) || isLoopFileSentinel(prompt)
}

/**
 * Ant `xY8`. Gate for the entire loop-prompt resolution path. When off,
 * sentinels are returned to the caller as-is (the model sees the
 * literal `<<autonomous-loop>>` string — useful for debugging).
 */
export function isLoopDefaultPromptEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_kairos_loop_prompt', false)
}

/**
 * Ant `_66` (verbatim). Env var beats the flag.
 *   - `CLAUDE_CODE_LOOP_PERSISTENT` set truthy → persistent
 *   - else `tengu_kairos_loop_persistent` feature flag → persistent
 *   - else default (steward)
 *
 * Public so the activation telemetry can report the resolved variant.
 */
export function isLoopPersistentPreambleEnabled(): boolean {
  const env = readEnv('CLAUDE_CODE_LOOP_PERSISTENT')
  if (env && /^(1|true|yes)$/i.test(env)) return true
  if (env && /^(0|false|no)$/i.test(env)) return false
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_kairos_loop_persistent',
    false,
  )
}

/**
 * Ant `CY8`. Returns the right preamble for the current session/env.
 */
export function getAutonomousLoopPreamble(): string {
  return isLoopPersistentPreambleEnabled()
    ? AUTONOMOUS_LOOP_PREAMBLE_PERSISTENT
    : AUTONOMOUS_LOOP_PREAMBLE
}

/**
 * Ant `IY8`. Fires `tengu_kairos_loop_persistent_activated` with a
 * `variant` boolean indicating whether the persistent preamble is
 * active. Called from `resolveAutonomousLoopFire` and the loop.md
 * fall-through path. NOT once-per-session — fires every time the loop
 * fires, so we can sample population behaviour.
 */
export function logAutonomousLoopActivation(): void {
  logEvent('tengu_kairos_loop_persistent_activated', {
    variant: String(
      isLoopPersistentPreambleEnabled(),
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/**
 * Ant `AzH` (2592.js). Push-notification feature gate — both the
 * GrowthBook flag AND the per-user opt-in must be set. The pacing
 * hint that mentions `${PushNotification}` is only emitted when this
 * returns true; otherwise the user can't act on it.
 *
 * Critical: ant reads the opt-in via `H3('agentPushNotifEnabled',!1).value`,
 * which is a *layered* settings lookup that walks user / project /
 * local / flag / policy sources in reverse precedence order, then
 * falls back to the legacy globalConfig key for promoted keys. ccb
 * mirrors that by checking the merged settings first (covers user /
 * project / local overrides) then falling back to globalConfig for
 * sessions that haven't migrated the legacy key yet.
 */
function isPushNotifEnabled(): boolean {
  if (
    !getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_kairos_push_notifications',
      false,
    )
  ) {
    return false
  }
  try {
    const fromSettings = getInitialSettings()?.agentPushNotifEnabled
    if (typeof fromSettings === 'boolean') return fromSettings
    return getGlobalConfig().agentPushNotifEnabled === true
  } catch {
    return false
  }
}

/**
 * Ant `iz_(isLoopFile = false)`. Pacing-aware hint appended to every
 * tick prompt. Returns empty string when push-notifs are off
 * (sending one wouldn't reach the user). The wording differs slightly
 * for the persistent variant ("third straight tick" trigger is
 * suppressed for persistent loops since they don't quit easily).
 */
function buildPushNotifPacingHint(isLoopFile = false): string {
  if (!isPushNotifEnabled()) return ''
  const persistent = !isLoopFile && isLoopPersistentPreambleEnabled()
  const triggers = persistent
    ? "newly blocked on a decision you won't make alone, you're ending the loop"
    : "newly blocked on a decision you won't make alone, third straight tick with nothing to do, you're ending the loop"
  return `

Use ${PUSH_NOTIFICATION_TOOL_NAME} when the loop can't move further without the user, or when something landed that they'd want to act on now: ${triggers}, or a major update arrived (CI went red, a review changes the plan). Progress you made yourself isn't a trigger — the transcript covers that. One ping per state, not per tick.`
}

/**
 * Ant `bY8` — heartbeat pacing reminder appended to dynamic-mode
 * ticks. Tells the model to use a 1200-1800s delay when MonitorMcp
 * is armed so the wake signal is the monitor, not the heartbeat.
 */
const SCHEDULE_WAKEUP_HEARTBEAT_HINT = `

If a ${MONITOR_MCP_TOOL_NAME} is armed (check ${TASK_STOP_TOOL_NAME}), keep \`delaySeconds\` at 1200–1800s — the ${MONITOR_MCP_TOOL_NAME} is the wake signal and this is only the fallback heartbeat. If you were woken by a \`<task-notification>\`, handle the event before rescheduling. To stop the loop, also ${TASK_STOP_TOOL_NAME} the monitor (use ${TASK_STOP_TOOL_NAME} to find its task ID if no longer in context).`

function autonomousLoopTickCron(): string {
  return `# Autonomous loop tick

Run the autonomous check using the loop instructions established earlier in this conversation. If you cannot find them, treat this as a no-op tick. The recurring cron will fire the next tick automatically — do not call ${SCHEDULE_WAKEUP_TOOL_NAME} from this tick.${buildPushNotifPacingHint()}`
}

function autonomousLoopTickDynamic(): string {
  return `# Autonomous loop tick (dynamic pacing)

Run the autonomous check using the loop instructions established earlier in this conversation. If you cannot find them, treat this as a no-op tick.

You scheduled this tick via the ${SCHEDULE_WAKEUP_TOOL_NAME} tool (not a recurring cron). To keep the loop alive, call ${SCHEDULE_WAKEUP_TOOL_NAME} again at the end of this turn with \`prompt\` set to the literal sentinel \`${AUTONOMOUS_LOOP_DYNAMIC_SENTINEL}\` — otherwise the loop ends after this tick.${SCHEDULE_WAKEUP_HEARTBEAT_HINT}${buildPushNotifPacingHint()}`
}

function loopFileTickCron(): string {
  return `# /loop tick — loop.md tasks

Work the tasks from the loop.md contents established earlier in this conversation. If you cannot find them, treat this as a no-op tick. The recurring cron will fire the next tick automatically — do not call ${SCHEDULE_WAKEUP_TOOL_NAME} from this tick.${buildPushNotifPacingHint(true)}`
}

function loopFileTickDynamic(): string {
  return `# /loop tick — loop.md tasks (dynamic pacing)

Work the tasks from the loop.md contents established earlier in this conversation. If you cannot find them, treat this as a no-op tick.

You scheduled this tick via the ${SCHEDULE_WAKEUP_TOOL_NAME} tool (not a recurring cron). To keep the loop alive, call ${SCHEDULE_WAKEUP_TOOL_NAME} again at the end of this turn with \`prompt\` set to the literal sentinel \`${LOOP_FILE_DYNAMIC_SENTINEL}\` — otherwise the loop ends after this tick.${SCHEDULE_WAKEUP_HEARTBEAT_HINT}${buildPushNotifPacingHint(true)}`
}

function loopFileTickAbsentDynamic(): string {
  return `# /loop tick — loop.md absent (dynamic pacing)

loop.md is not currently present. Run the autonomous check using the loop instructions established earlier in this conversation.

You scheduled this tick via the ${SCHEDULE_WAKEUP_TOOL_NAME} tool (not a recurring cron). To keep the loop alive — and to pick up loop.md if it is recreated — call ${SCHEDULE_WAKEUP_TOOL_NAME} again at the end of this turn with \`prompt\` set to the literal sentinel \`${LOOP_FILE_DYNAMIC_SENTINEL}\` — otherwise the loop ends after this tick.${SCHEDULE_WAKEUP_HEARTBEAT_HINT}${buildPushNotifPacingHint()}`
}

function truncateLoopFile(content: string): string {
  if (content.length <= LOOP_FILE_MAX_BYTES) return content
  const cutAt = content.lastIndexOf('\n', LOOP_FILE_MAX_BYTES)
  const head = content.slice(0, cutAt > 0 ? cutAt : LOOP_FILE_MAX_BYTES)
  return `${head}\n\n> WARNING: loop.md was truncated to ${LOOP_FILE_MAX_BYTES} bytes. Keep the task list concise.`
}

/**
 * Ant `$67` — find a loop.md to use. Project-local takes priority over
 * the Claude config home (NOT $HOME — ant explicitly resolves the
 * fallback via `n6()`, i.e. `getClaudeConfigHomeDir()` so users with
 * `CLAUDE_CONFIG_DIR` set get the right base. Returns null if neither
 * path exists or both are empty after trim.
 *
 * Critical: ant's second candidate is `~/.claude/loop.md`, NOT
 * `~/loop.md`. The prior ccb impl used `homedir()` which would
 * silently miss the file for anyone with `CLAUDE_CONFIG_DIR` set, and
 * also write to / read from a different path than the rest of the
 * Claude state tree.
 */
export function readLoopFile(): { path: string; content: string } | null {
  const candidates = [
    join(getCwd(), '.claude', 'loop.md'),
    join(getClaudeConfigHomeDir(), 'loop.md'),
  ]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    let raw: string
    try {
      raw = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    return { path, content: truncateLoopFile(trimmed) }
  }
  return null
}

/**
 * Ant `A67`. Resolve `<<autonomous-loop>>` / `<<autonomous-loop-dynamic>>`
 * to the real tick prompt. First fire of the session prepends the
 * appropriate preamble; later fires return only the short tick string.
 *
 * Telemetry: `tengu_kairos_loop_persistent_activated` fires on every
 * autonomous fire (ant IY8) so we can sample which variant is active
 * across the population. The first-fire guard only suppresses the
 * heavy preamble, not the telemetry.
 */
export function resolveAutonomousLoopFire(prompt: string): string | null {
  if (!isAutonomousLoopSentinel(prompt)) return null
  if (!isLoopDefaultPromptEnabled()) return null
  logAutonomousLoopActivation()
  const tick =
    prompt === AUTONOMOUS_LOOP_DYNAMIC_SENTINEL
      ? autonomousLoopTickDynamic()
      : autonomousLoopTickCron()
  if (loopPreambleDelivered || loopFileLastContent !== null) return tick
  loopPreambleDelivered = true
  return `${getAutonomousLoopPreamble()}

---

${tick}`
}

/**
 * Ant `Y67`. Resolve `<<loop.md>>` / `<<loop.md-dynamic>>` against the
 * on-disk file. If the file content matches the previous fire, only
 * the short tick is returned. If it changed (or is the first fire),
 * full context is repeated.
 *
 * When loop.md is missing, falls through to the autonomous-loop
 * preamble — using `LOOP_FALLBACK_PREAMBLE_SENTINEL` as the equality
 * key so we don't store the whole preamble in the cache slot.
 */
export function resolveLoopFileFire(prompt: string): string | null {
  if (!isLoopFileSentinel(prompt)) return null
  if (!isLoopDefaultPromptEnabled()) return null
  const isDynamic = prompt === LOOP_FILE_DYNAMIC_SENTINEL
  const file = readLoopFile()
  if (file !== null) {
    const tick = isDynamic ? loopFileTickDynamic() : loopFileTickCron()
    if (loopFileLastContent === file.content) return tick
    loopFileLastContent = file.content
    return `# /loop tick — tasks from ${file.path}

The user configured a loop-tasks file. Work through the tasks defined below; these are the instructions for this tick and every subsequent tick (the reminder on later fires refers back to this message).

---

${file.content}

---

${tick}`
  }
  // No loop.md present — fall through to the autonomous tick. ant Y67
  // calls IY8() before deciding to prepend, so the telemetry fires on
  // every loop.md fallthrough tick regardless of whether the preamble
  // is rendered.
  logAutonomousLoopActivation()
  const tick = isDynamic ? loopFileTickAbsentDynamic() : autonomousLoopTickCron()
  if (
    loopFileLastContent === LOOP_FALLBACK_PREAMBLE_SENTINEL ||
    loopPreambleDelivered
  ) {
    return tick
  }
  loopFileLastContent = LOOP_FALLBACK_PREAMBLE_SENTINEL
  loopPreambleDelivered = true
  return `${getAutonomousLoopPreamble()}

---

${tick}`
}

/**
 * Default fire-prompt resolver. Try autonomous-loop sentinels first,
 * then loop.md sentinels, fall through to the original prompt. The
 * cron tick fire path calls this on every prompt before queueing it
 * for the model.
 */
export function resolveLoopDefaultFire(prompt: string): string {
  return (
    resolveAutonomousLoopFire(prompt) ??
    resolveLoopFileFire(prompt) ??
    prompt
  )
}
