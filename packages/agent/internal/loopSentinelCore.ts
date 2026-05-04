/**
 * Loop fire-prompt sentinel resolution — port of upstream v2.1.123
 * (resplit/2869.js).
 *
 * The cron scheduler emits `task.prompt` verbatim when a wakeup fires. For
 * autonomous loops and loop.md-driven loops we want to substitute a much
 * richer instruction prompt at fire time, so the model gets the steward
 * preamble (first fire) or a short "loop tick" reminder (subsequent fires)
 * instead of a literal `<<autonomous-loop>>` string. `resolveLoopDefaultFire`
 * is the single entry point useScheduledTasks plumbs into the queue.
 *
 * Per-session state:
 *   `loopPreambleDelivered` — once-per-session flag for the heavy preamble.
 *   `loopFileLastContent`   — content of the last loop.md we expanded; used
 *                             to redeliver full context when the file changes.
 */

import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { getCwd } from '@claude-code/app-host/bootstrap/cwd.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'
// SCHEDULE_WAKEUP_TOOL_NAME is referenced inside prompts; we keep the
// constant inline here to avoid a tools→agent→tools import cycle.
const SCHEDULE_WAKEUP_TOOL_NAME = 'ScheduleWakeup'

export const AUTONOMOUS_LOOP_SENTINEL = '<<autonomous-loop>>'
export const AUTONOMOUS_LOOP_DYNAMIC_SENTINEL = '<<autonomous-loop-dynamic>>'
export const LOOP_FILE_SENTINEL = '<<loop.md>>'
export const LOOP_FILE_DYNAMIC_SENTINEL = '<<loop.md-dynamic>>'

const LOOP_FILE_MAX_BYTES = 25_000

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

Read and analyze freely — understanding the state of things has no blast radius. Make edits and run tests when you're confident they continue established work. Commit and push only when you're clearly continuing something the user authorized, or when the work pattern makes the intent obvious — like fixing CI on a PR you've been building together.`

// Per-session state — module-level. Reset on session switch via the
// resetAutonomousLoopDelivered export.
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
 * Loop prompt section gate — when off, sentinels are returned as-is and the
 * model sees the literal `<<autonomous-loop>>` string. Useful for testing.
 */
export function isLoopDefaultPromptEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_kairos_loop_prompt', false)
}

function autonomousLoopTickCron(): string {
  return `# Autonomous loop tick

Run the autonomous check using the loop instructions established earlier in this conversation. If you cannot find them, treat this as a no-op tick. The recurring cron will fire the next tick automatically — do not call ${SCHEDULE_WAKEUP_TOOL_NAME} from this tick.`
}

function autonomousLoopTickDynamic(): string {
  return `# Autonomous loop tick (dynamic pacing)

Run the autonomous check using the loop instructions established earlier in this conversation. If you cannot find them, treat this as a no-op tick.

You scheduled this tick via the ${SCHEDULE_WAKEUP_TOOL_NAME} tool (not a recurring cron). To keep the loop alive, call ${SCHEDULE_WAKEUP_TOOL_NAME} again at the end of this turn with \`prompt\` set to the literal sentinel \`${AUTONOMOUS_LOOP_DYNAMIC_SENTINEL}\` — otherwise the loop ends after this tick.`
}

function loopFileTickCron(): string {
  return `# /loop tick — loop.md tasks

Work the tasks from the loop.md contents established earlier in this conversation. If you cannot find them, treat this as a no-op tick. The recurring cron will fire the next tick automatically — do not call ${SCHEDULE_WAKEUP_TOOL_NAME} from this tick.`
}

function loopFileTickDynamic(): string {
  return `# /loop tick — loop.md tasks (dynamic pacing)

Work the tasks from the loop.md contents established earlier in this conversation. If you cannot find them, treat this as a no-op tick.

You scheduled this tick via the ${SCHEDULE_WAKEUP_TOOL_NAME} tool (not a recurring cron). To keep the loop alive, call ${SCHEDULE_WAKEUP_TOOL_NAME} again at the end of this turn with \`prompt\` set to the literal sentinel \`${LOOP_FILE_DYNAMIC_SENTINEL}\` — otherwise the loop ends after this tick.`
}

function loopFileTickAbsentDynamic(): string {
  return `# /loop tick — loop.md absent (dynamic pacing)

loop.md is not currently present. Run the autonomous check using the loop instructions established earlier in this conversation.

You scheduled this tick via the ${SCHEDULE_WAKEUP_TOOL_NAME} tool (not a recurring cron). To keep the loop alive — and to pick up loop.md if it is recreated — call ${SCHEDULE_WAKEUP_TOOL_NAME} again at the end of this turn with \`prompt\` set to the literal sentinel \`${LOOP_FILE_DYNAMIC_SENTINEL}\` — otherwise the loop ends after this tick.`
}

function truncateLoopFile(content: string): string {
  if (content.length <= LOOP_FILE_MAX_BYTES) return content
  const cutAt = content.lastIndexOf('\n', LOOP_FILE_MAX_BYTES)
  const head = content.slice(0, cutAt > 0 ? cutAt : LOOP_FILE_MAX_BYTES)
  return `${head}\n\n> WARNING: loop.md was truncated to ${LOOP_FILE_MAX_BYTES} bytes. Keep the task list concise.`
}

/**
 * Find a loop.md to use. Project-local takes priority over $HOME. Returns
 * null if neither path exists or both are empty after trim.
 */
export function readLoopFile(): { path: string; content: string } | null {
  const candidates = [
    join(getCwd(), '.claude', 'loop.md'),
    join(homedir(), 'loop.md'),
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
 * Resolve `<<autonomous-loop>>` / `<<autonomous-loop-dynamic>>` to the real
 * tick prompt. First fire of the session prepends the long preamble; later
 * fires return only the short tick string.
 */
export function resolveAutonomousLoopFire(prompt: string): string | null {
  if (!isAutonomousLoopSentinel(prompt)) return null
  if (!isLoopDefaultPromptEnabled()) return null
  const tick =
    prompt === AUTONOMOUS_LOOP_DYNAMIC_SENTINEL
      ? autonomousLoopTickDynamic()
      : autonomousLoopTickCron()
  if (loopPreambleDelivered || loopFileLastContent !== null) return tick
  loopPreambleDelivered = true
  return `${AUTONOMOUS_LOOP_PREAMBLE}\n\n---\n\n${tick}`
}

/**
 * Resolve `<<loop.md>>` / `<<loop.md-dynamic>>` against the on-disk file.
 * If the file content matches the previous fire, only the short tick is
 * returned. If it changed (or is the first fire), full context is repeated.
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
  // No loop.md present — fall through to the autonomous tick. Match
  // upstream's once-per-session preamble guard so users don't see it
  // twice if they switch between modes mid-session.
  const tick = isDynamic ? loopFileTickAbsentDynamic() : autonomousLoopTickCron()
  if (loopFileLastContent === AUTONOMOUS_LOOP_PREAMBLE || loopPreambleDelivered) {
    return tick
  }
  loopFileLastContent = AUTONOMOUS_LOOP_PREAMBLE
  loopPreambleDelivered = true
  return `${AUTONOMOUS_LOOP_PREAMBLE}\n\n---\n\n${tick}`
}

/**
 * Default fire-prompt resolver. Try autonomous-loop sentinels first, then
 * loop.md sentinels, fall through to the original prompt. The cron tick
 * fire path calls this on every prompt before queueing it for the model.
 */
export function resolveLoopDefaultFire(prompt: string): string {
  return (
    resolveAutonomousLoopFire(prompt) ??
    resolveLoopFileFire(prompt) ??
    prompt
  )
}
