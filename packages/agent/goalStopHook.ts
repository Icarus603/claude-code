/**
 * /goal Stop-hook lifecycle — port of ant v2.1.136 4513.js (gYK module) +
 * 4688.js (lPK / local-jsx call) + 4689.js (iPK / local call) + 3973.js
 * hd7 (Stop-hook evaluator wire).
 *
 * Maps ant identifiers verbatim:
 *   - krH  → addGoalStopHook
 *   - VrH  → clearGoalStopHook
 *   - Rj6  → existingGoalHooks  (the matcher='' + no skillRoot + type='prompt' scan)
 *   - dYK  → buildGoalSentinelAttachment (`{met, sentinel:true, condition}`)
 *   - LrH  → GOAL_CONDITION_MAX_LENGTH (4000)
 *   - jf3  → GOAL_CLEAR_KEYWORDS (case-insensitive: clear/stop/off/reset/none/cancel)
 *   - Gj6  → buildGoalMetaMessage
 *   - Pj6  → isGoalClearKeyword
 *   - qZ3  → renderActiveGoalStatus (with KZ3 "last met" lookback)
 *   - KZ3  → findMostRecentMetGoalStatus
 *   - Wj6  → formatLastCheck (` "Last check: <reason>" `)
 *   - HoH  → isGoalCommandEnabled (ccb default-on, env kill-switch)
 *
 * Algorithm (matches ant byte-for-byte):
 *   addGoalStopHook (krH):
 *     1. Find every "via:goal"-shaped Stop hook in session (Rj6).
 *     2. Remove all of them.
 *     3. Add a fresh Stop hook of `{type:'prompt', prompt:condition}` with
 *        empty matcher.
 *     4. Set AppState.activeGoal = {condition, iterations:0, setAt:Date.now()}.
 *     5. Append `dYK(false, condition)` attachment to messages
 *        (`{type:'goal_status', met:false, sentinel:true, condition}`).
 *     6. logEvent('tengu_stop_hook_added', {promptLength, via:'goal'}).
 *     7. logForDebugging('goal_set').
 *
 *   clearGoalStopHook (VrH):
 *     1. Find every "via:goal"-shaped Stop hook (Rj6).
 *     2. If none → return null.
 *     3. Capture FIRST hook's prompt as the condition (= clearing message).
 *     4. Remove ALL matched hooks.
 *     5. Clear AppState.activeGoal.
 *     6. Append `dYK(true, condition)` attachment to messages
 *        (`{type:'goal_status', met:true, sentinel:true, condition}`).
 *     7. logEvent('tengu_stop_hook_removed', {via:'goal'}).
 *     8. Return the condition.
 *
 *   evaluateGoalOnStopHookSuccess (3973.js hd7 inner branch):
 *     - If the executed hook's prompt equals activeGoal.condition AND
 *       result.success: bump iterations, compute durationMs from setAt,
 *       clear activeGoal, emit goal_status `{met:true, condition, reason,
 *       iterations, durationMs}` (NO sentinel), logEvent
 *       'tengu_goal_achieved' with promptLength+iterations+durationMs,
 *       logForDebugging('goal_met'). Hook itself is removed by the caller
 *       in the same path (R(b.hook) → sessionHooksRegistry.remove).
 *
 *   evaluateGoalOnStopHookBlocking (3973.js hd7 blocking branch):
 *     - If the blocking hook prompt equals activeGoal.condition:
 *       set activeGoal = {...activeGoal, iterations+1, lastReason:reason},
 *       emit goal_status `{met:false, condition, reason}` (NO sentinel).
 *       Hook is NOT removed — it stays active so the goal keeps blocking.
 */
import { randomUUID } from 'node:crypto'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '@claude-code/local-observability'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import {
  isEnvDefinedFalsy,
  isEnvTruthy,
  readEnv,
} from '@claude-code/config/env/utils'
import { getTotalOutputTokens } from '@claude-code/app-host/bootstrap/state.js'
import type { HookCommand } from '@claude-code/config/types'
import {
  shouldDisableAllHooksIncludingManaged,
  shouldAllowManagedHooksOnly,
} from './hooksConfigSnapshot.js'
import {
  addSessionHook,
  getSessionHooks,
  removeSessionHook,
} from './hooks/sessionHooks.js'
import type { AttachmentMessage, Message } from './messageShapes.js'

/** Hard cap on the condition string. ant 4513.js LrH=4000. */
export const GOAL_CONDITION_MAX_LENGTH = 4000

/**
 * Case-insensitive keywords that map to "clear the goal". ant 4514.js jf3.
 * Anything else of any length is treated as a new condition string.
 */
export const GOAL_CLEAR_KEYWORDS = new Set([
  'clear',
  'stop',
  'off',
  'reset',
  'none',
  'cancel',
])

export type ActiveGoal = {
  condition: string
  iterations: number
  setAt: number
  /** Last failure reason from a blocking Stop hook eval — ant 3973.js. */
  lastReason?: string
  /** Cumulative output tokens at goal-set time — ant v2.1.142 nf(). */
  tokensAtStart: number
  /** User-paused goals retain status in AppState but remove the Stop hook. */
  paused?: boolean
}

/** Most-recent met-goal record, surfaced as "Last: ✔ <cond> — <stats>". */
export type LastMetGoalRecord = {
  condition: string
  stats: string
  /** Cumulative output tokens consumed — ant v2.1.142 nf() delta. */
  tokens?: number
}

/**
 * Ant `Pj6`: case-insensitive match against GOAL_CLEAR_KEYWORDS. Decided
 * separately from the input parser so non-interactive callers (local
 * command) can share the gate.
 */
export function isGoalClearKeyword(input: string): boolean {
  return GOAL_CLEAR_KEYWORDS.has(input.toLowerCase())
}

/**
 * Ant `HoH`: /goal feature gate. ccb is a solo-maintained CLI, not an
 * enterprise product — no need to mirror ant's GrowthBook gating. The
 * command is always enabled; CLAUDE_CODE_DISABLE_GOAL=1 turns it off as
 * an emergency kill-switch.
 */
export function isGoalCommandEnabled(): boolean {
  return !isEnvTruthy(readEnv('CLAUDE_CODE_DISABLE_GOAL'))
}

/**
 * Ant `bp` (2518.js): the single RUNTIME gate for EVERY Workflow surface —
 * the Workflow tool (3904 `isEnabled:()=>bp()`), the `ultrawork` keyword
 * highlight (5163 `bp()?Ap8(j7):[]`) + `ultrawork_request` attachment (4135
 * `FZ3`), and the `/workflows` command (4938). ant gates on
 * `CLAUDE_CODE_WORKFLOWS` env opt-IN + `tengu_workflows_enabled`.
 *
 * ccb defaults ON (solo-operator, like `/goal`); `CLAUDE_CODE_WORKFLOWS=0` is
 * the kill-switch (opt-OUT). Folds in the `/goal` kill-switch too. Replaces
 * the former build flags ULTRAWORK + WORKFLOW_SCRIPTS, which mis-ported one
 * runtime gate as two default-off build flags — `feature()` DCE then stripped
 * the whole subsystem from every shipped binary.
 */
export function isWorkflowsEnabled(): boolean {
  if (isEnvDefinedFalsy(readEnv('CLAUDE_CODE_WORKFLOWS'))) return false
  return isGoalCommandEnabled()
}

/**
 * Ant `PB8` hooks-gate half: returns true when hooks are globally
 * disabled or managed-only. This check lives here (shared by all goal
 * callers); the trust-gate check lives in the callers (command handlers,
 * session-restore) so we don't create an import cycle with bootstrap/state.
 */
export function isGoalBlockedByHooksGate(): boolean {
  return (
    shouldDisableAllHooksIncludingManaged() ||
    shouldAllowManagedHooksOnly()
  )
}

/** ant 4574.js `$V3` / `zV3` — user-facing gate messages. */
export const GOAL_TRUST_GATE_MESSAGE =
  '/goal is only available in trusted workspaces. Restart, accept the trust dialog, and try again.'
export const GOAL_HOOKS_GATE_MESSAGE =
  "/goal can't run while hooks are disabled (disableAllHooks or allowManagedHooksOnly is set in settings or by policy)."

export type GoalGateResult = {
  message: string
  code: 'hooks_gate' | 'trust_gate'
}

/**
 * Ant `PB8` (4574.js): full gate for /goal set. Returns the reason if
 * blocked, or null if allowed. ant's exact predicate:
 *   if (disableAllHooks || allowManagedHooksOnly) → hooks_gate
 *   if (!isNonInteractive && !trustDialogAccepted) → trust_gate
 *
 * Trust gate exempts non-interactive sessions: -p / SDK / headless paths
 * don't get the interactive trust dialog, so requiring it would lock /goal
 * out of every CI integration.
 *
 * Callers must emit `tengu_feature_sad {feature_name:'goal_set', error_code}`
 * themselves so they can attach the surface they were called from
 * (local-jsx vs local) — same as ant baH() does at the call site.
 */
export function checkGoalSetGate(deps: {
  isNonInteractive: () => boolean
  hasTrustDialogAccepted: () => boolean
}): GoalGateResult | null {
  if (isGoalBlockedByHooksGate()) {
    return { message: GOAL_HOOKS_GATE_MESSAGE, code: 'hooks_gate' }
  }
  if (!deps.isNonInteractive() && !deps.hasTrustDialogAccepted()) {
    return { message: GOAL_TRUST_GATE_MESSAGE, code: 'trust_gate' }
  }
  return null
}

/** Ant `Wj6`. Plain-text formatter for activeGoal.lastReason. */
export function formatLastCheck(reason: string): string {
  return `Last check: ${reason.trim()}`
}

/**
 * Minimal context shape /goal needs. Mirrors ant's per-tool ToolUseContext
 * subset — we don't need the full ToolUseContext because /goal only touches
 * AppState + setMessages.
 */
export type GoalHookContext = {
  getAppState: () => {
    activeGoal?: ActiveGoal
    sessionHooks: Map<
      string,
      {
        hooks: {
          [key: string]: Array<{
            matcher: string
            skillRoot?: string
            hooks: Array<{ hook: HookCommand | { type: 'function' } }>
          }>
        }
      }
    >
  }
  setAppState: (updater: (prev: any) => any) => void
  sessionId: string
  setMessages: (updater: (prev: Message[]) => Message[]) => void
  /** Optional read of current message list (for renderActiveGoalStatus lookback). */
  getMessages?: () => Message[]
}

/**
 * Build the `dYK(met, condition)` sentinel attachment. Sentinel marks
 * /goal lifecycle events (set / clear) so the "last met goal" lookup
 * (`KZ3`) can skip them — only real Stop-hook-eval `met:true` records
 * count as a completion.
 */
function buildGoalSentinelAttachment(
  met: boolean,
  condition: string,
): AttachmentMessage {
  return {
    type: 'attachment',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    attachment: {
      type: 'goal_status',
      met,
      sentinel: true,
      condition,
    },
  }
}

/**
 * Locate every "/goal-shaped" Stop hook in the current session. Mirrors
 * ant Rj6 — same three-clause filter: empty matcher, no skillRoot,
 * `type === 'prompt'`.
 */
function existingGoalHooks(ctx: GoalHookContext): HookCommand[] {
  const state = ctx.getAppState()
  const hooksMap = getSessionHooks(state, ctx.sessionId, 'Stop')
  const stop = hooksMap.get('Stop') ?? []
  const matches: HookCommand[] = []
  for (const matcher of stop) {
    if (matcher.matcher !== '' || matcher.skillRoot !== undefined) continue
    for (const hook of matcher.hooks) {
      if (hook.type === 'prompt') matches.push(hook)
    }
  }
  return matches
}

function clearGoalRuntimeState(
  setAppState: GoalHookContext['setAppState'],
  sessionId: string,
): void {
  setAppState(prev => {
    const store = prev.sessionHooks.get(sessionId)
    if (!store) return { ...prev, activeGoal: undefined }

    const stopMatchers = store.hooks.Stop ?? []
    const updatedStopMatchers = stopMatchers.flatMap(matcher => {
      if (matcher.matcher !== '' || matcher.skillRoot !== undefined) {
        return [matcher]
      }
      const hooks = matcher.hooks.filter(({ hook }) => hook.type !== 'prompt')
      return hooks.length === 0 ? [] : [{ ...matcher, hooks }]
    })

    const hooks = { ...store.hooks }
    if (updatedStopMatchers.length === 0) {
      delete hooks.Stop
    } else {
      hooks.Stop = updatedStopMatchers
    }
    prev.sessionHooks.set(sessionId, { ...store, hooks })
    return { ...prev, activeGoal: undefined }
  })
}

/**
 * Add a /goal Stop hook. Replaces any existing /goal hook (no two goals
 * at once — ant's krH semantics).
 */
export function addGoalStopHook(
  condition: string,
  ctx: GoalHookContext,
): void {
  // 1. First clear any pre-existing goal hooks so we don't end up with two.
  for (const hook of existingGoalHooks(ctx)) {
    removeSessionHook(ctx.setAppState, ctx.sessionId, 'Stop', hook)
  }
  // 2. Add the new prompt hook with empty matcher.
  const promptHook: HookCommand = {
    type: 'prompt',
    prompt: condition,
  }
  addSessionHook(
    ctx.setAppState,
    ctx.sessionId,
    'Stop',
    '',
    promptHook,
  )
  // 3. Set AppState.activeGoal — include tokensAtStart so we can compute
  //    token consumption toward the goal (ant v2.1.142 nf() baseline).
  ctx.setAppState(prev => ({
    ...prev,
    activeGoal: {
      condition,
      iterations: 0,
      setAt: Date.now(),
      tokensAtStart: getTotalOutputTokens(),
    } satisfies ActiveGoal,
  }))
  // 4. Append the `dYK(false, condition)` sentinel to messages so the
  //    model sees that a goal was just installed. ant 4513.js krH.
  ctx.setMessages(prev => [
    ...prev,
    buildGoalSentinelAttachment(false, condition),
  ])
  // 5. Telemetry.
  logEvent('tengu_stop_hook_added', {
    promptLength: condition.length,
    via: 'goal',
  })
  logForDebugging('goal_set')
}

/**
 * Clear the active /goal Stop hook. Returns the prior condition (so the
 * caller can show "Goal cleared: <text>"), or null when no goal was set.
 */
function appendGoalStatusAttachment(
  ctx: GoalHookContext,
  attachment: {
    met: boolean
    condition: string
    failed?: boolean
    paused?: boolean
    reason?: string
    iterations?: number
    durationMs?: number
    tokens?: number
  },
): void {
  ctx.setMessages(prev => [
    ...prev,
    {
      type: 'attachment',
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
      attachment: {
        type: 'goal_status',
        ...attachment,
      },
    } as AttachmentMessage,
  ])
}

export function pauseGoalStopHook(ctx: GoalHookContext): string | null {
  const activeGoal = ctx.getAppState().activeGoal
  if (!activeGoal) return null
  for (const hook of existingGoalHooks(ctx)) {
    removeSessionHook(ctx.setAppState, ctx.sessionId, 'Stop', hook)
  }
  ctx.setAppState(prev => ({
    ...prev,
    activeGoal: prev.activeGoal && { ...prev.activeGoal, paused: true },
  }))
  appendGoalStatusAttachment(ctx, {
    met: false,
    paused: true,
    condition: activeGoal.condition,
    reason: 'Goal paused by user',
    iterations: activeGoal.iterations,
    tokens: getTotalOutputTokens() - activeGoal.tokensAtStart,
  })
  logEvent('tengu_goal_paused', { promptLength: activeGoal.condition.length })
  return activeGoal.condition
}

export function resumeGoalStopHook(ctx: GoalHookContext): string | null {
  const activeGoal = ctx.getAppState().activeGoal
  if (!activeGoal) return null
  for (const hook of existingGoalHooks(ctx)) {
    removeSessionHook(ctx.setAppState, ctx.sessionId, 'Stop', hook)
  }
  addSessionHook(ctx.setAppState, ctx.sessionId, 'Stop', '', {
    type: 'prompt',
    prompt: activeGoal.condition,
  })
  ctx.setAppState(prev => ({
    ...prev,
    activeGoal: prev.activeGoal && { ...prev.activeGoal, paused: false },
  }))
  appendGoalStatusAttachment(ctx, {
    met: false,
    condition: activeGoal.condition,
    reason: 'Goal resumed by user',
    iterations: activeGoal.iterations,
    tokens: getTotalOutputTokens() - activeGoal.tokensAtStart,
  })
  logEvent('tengu_goal_resumed', { promptLength: activeGoal.condition.length })
  return activeGoal.condition
}

export function clearGoalStopHook(ctx: GoalHookContext): string | null {
  const matches = existingGoalHooks(ctx)
  const activeGoal = ctx.getAppState().activeGoal
  if (matches.length === 0 && activeGoal === undefined) return null
  // ant VrH: first hook's prompt is the canonical "condition" used in the
  // cleared message even if more than one goal hook somehow co-existed.
  const first = matches[0]
  const condition =
    first?.type === 'prompt'
      ? (first as { prompt: string }).prompt
      : activeGoal?.condition ?? ''
  for (const hook of matches) {
    removeSessionHook(ctx.setAppState, ctx.sessionId, 'Stop', hook)
  }
  clearGoalRuntimeState(ctx.setAppState, ctx.sessionId)
  // Sentinel attachment so the model sees a clear event in the transcript.
  ctx.setMessages(prev => [
    ...prev,
    buildGoalSentinelAttachment(true, condition),
  ])
  logEvent('tengu_stop_hook_removed', { via: 'goal' })
  return condition
}

/**
 * Ant `KZ3`. Walk messages backward; return the most recent goal_status
 * attachment that is `met:true && !sentinel` — that's the canonical
 * "this goal completed for real" marker (as opposed to a `/goal clear`
 * sentinel which is also `met:true` but has `sentinel:true`).
 */
export function findMostRecentMetGoalStatus(
  messages: Message[],
): LastMetGoalRecord | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as
      | (Message & {
          type: 'attachment'
          attachment: {
            type: string
            met?: boolean
            sentinel?: boolean
            condition?: string
            durationMs?: number
            iterations?: number
          }
        })
      | undefined
    if (!m || m.type !== 'attachment') continue
    const att = m.attachment as {
      type: string
      met?: boolean
      sentinel?: boolean
      condition?: string
      durationMs?: number
      iterations?: number
      tokens?: number
    }
    if (att.type !== 'goal_status') continue
    if (!att.met || att.sentinel) continue
    const stats: string[] = []
    if (att.durationMs !== undefined) {
      stats.push(formatDurationCompact(att.durationMs))
    }
    if (att.iterations !== undefined) {
      stats.push(`${att.iterations} ${pluralize(att.iterations, 'turn')}`)
    }
    if (att.tokens !== undefined) {
      stats.push(`${formatTokensCompact(att.tokens)} tokens`)
    }
    const ts = (m as { timestamp?: string }).timestamp
    stats.push(formatRelativeDate(ts ? new Date(ts) : new Date()))
    return {
      condition: att.condition ?? '',
      stats: stats.join(' · '),
      tokens: att.tokens,
    }
  }
  return null
}

/**
 * A single goal "run" extracted from the transcript, for the `/workflows`
 * history browser. ccb has no separate workflow snapshot store (ant's
 * `se7()`); goal runs live entirely as `goal_status` attachments in the
 * message log. This is the faithful ccb analogue of ant's local_workflow
 * task list (4935.js GlK) — one entry per completed/failed/active goal.
 */
export type GoalRunRecord = {
  /** Stable id derived from the originating attachment uuid (or index). */
  id: string
  condition: string
  status: 'running' | 'completed' | 'failed'
  /** Epoch ms of the terminal event (or set time for a running goal). */
  timestamp: number
  iterations?: number
  durationMs?: number
  tokens?: number
  /** Last evaluator reason (failure / blocking message). */
  reason?: string
}

/**
 * Walk the transcript and collect every terminal goal record — both
 * achieved (`met:true && !sentinel`) and impossible (`failed:true`). These
 * map to "completed" rows in `/workflows`. The currently-active goal (from
 * AppState) is prepended by the dialog as the single "running" row, since
 * an in-progress goal has no terminal attachment yet.
 *
 * Records are returned newest-first (matching ant GlK's E4O sort by
 * startTime desc).
 */
export function findAllGoalRecords(messages: Message[]): GoalRunRecord[] {
  const records: GoalRunRecord[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] as
      | (Message & {
          type: 'attachment'
          uuid?: string
          timestamp?: string
          attachment: {
            type: string
            met?: boolean
            failed?: boolean
            sentinel?: boolean
            condition?: string
            iterations?: number
            durationMs?: number
            tokens?: number
            reason?: string
          }
        })
      | undefined
    if (!m || m.type !== 'attachment') continue
    const att = m.attachment
    if (att.type !== 'goal_status') continue
    // Sentinels (set / clear lifecycle markers) are not runs.
    if (att.sentinel) continue
    // Only terminal records: achieved or impossible. Blocking (met:false,
    // !failed) updates are mid-run iterations, not completions.
    const completed = att.met === true
    const failed = att.failed === true
    if (!completed && !failed) continue
    const ts = m.timestamp ? Date.parse(m.timestamp) : Date.now()
    records.push({
      id: m.uuid ?? `goal-${i}`,
      condition: att.condition ?? '',
      status: completed ? 'completed' : 'failed',
      timestamp: Number.isNaN(ts) ? Date.now() : ts,
      iterations: att.iterations,
      durationMs: att.durationMs,
      tokens: att.tokens,
      reason: att.reason,
    })
  }
  return records.sort((a, b) => b.timestamp - a.timestamp)
}

/**
 * Ant `qZ3`. Render the multiline status block shown when the user types
 * `/goal` with no args.
 *
 * Format when no active goal:
 *   "No goal set. Usage: `/goal <condition>`"
 *   "Last: ✔ <cond> — <stats>"  (only if a prior met goal exists)
 *
 * Format when goal active:
 *   "● Goal: <condition>"
 *   "set <relative-time> · <iter-string>"
 *   "Last check: <lastReason>"   (only when lastReason exists)
 *   "`/goal clear` to remove"
 */
export function renderActiveGoalStatus(
  goal: ActiveGoal | undefined,
  messages: Message[] = [],
): string {
  if (!goal) {
    const last = findMostRecentMetGoalStatus(messages)
    const lines = ['No goal set. Usage: `/goal <condition>`']
    if (last) {
      lines.push(`Last: ✔ ${last.condition} — ${last.stats}`)
    }
    return lines.join('\n')
  }
  const iter =
    goal.iterations === 0
      ? 'not yet evaluated'
      : `${goal.iterations} ${pluralize(goal.iterations, 'iteration')}`
  const status = goal.paused ? 'paused' : iter
  const setLine = `set ${formatRelativeDate(new Date(goal.setAt))} · `
  // Compute token delta from goal baseline — ant v2.1.142 nf() delta.
  // Safe-guarded: in test environments getTotalOutputTokens may not be
  // wired yet; skip the line rather than crashing.
  let tokenLine: string | undefined
  try {
    const tokenDelta = getTotalOutputTokens() - goal.tokensAtStart
    tokenLine = `${formatTokensCompact(tokenDelta)} tokens consumed`
  } catch {
    // bootstrap/state not initialised (test environment) — skip
  }
  const lines: Array<string | false | undefined> = [
    `● Goal: ${goal.condition}`,
    `${setLine}${status}`,
    tokenLine,
    goal.lastReason && formatLastCheck(goal.lastReason),
    goal.paused
      ? '`/goal resume` to continue · `/goal clear` to remove'
      : '`/goal pause` to pause · `/goal clear` to remove',
  ]
  return lines.filter(Boolean).join('\n')
}

/**
 * Build the meta-message that nudges the agent when a goal is freshly set.
 * Verbatim ant Gj6 (v2.1.136 4513.js).
 */
export function buildGoalMetaMessage(condition: string): string {
  return `A session-scoped Stop hook is now active with condition: "${condition}". Briefly acknowledge the goal, then immediately start (or continue) working toward it — treat the condition itself as your directive and do not pause to ask the user what to do. The hook will block stopping until the condition holds. It auto-clears once the condition is met — do not tell the user to run \`/goal clear\` after success; that's only for clearing a goal early.`
}

// ─── session restore ────────────────────────────────────────────────────

/**
 * Ant `BQK` (v2.1.143 5083.js, was `wbK` in v2.1.136). Walk messages backward;
 * return the condition of the LAST goal_status attachment ONLY IF that
 * attachment is unresolved (`!met && !failed`). Returns null otherwise.
 *
 * Three terminal states make a stale goal unsafe to restore:
 *   - `met:true && !sentinel` — goal was achieved by the evaluator
 *   - `met:true && sentinel`  — user ran `/goal clear`
 *   - `failed:true`           — evaluator returned `impossible:true`
 *
 * Without the `failed` check, resuming a session whose goal was judged
 * impossible would silently re-arm the same impossible goal. ant 1.43
 * added this check when impossible was introduced; ccb shipped impossible
 * (stopHooksCore.ts) without the matching restore-side guard.
 */
type GoalRestoreState = {
  condition: string
  paused: boolean
}

function findGoalRestoreState(messages: Message[]): GoalRestoreState | null {
  if (!messages) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as
      | (Message & {
          type: 'attachment'
          attachment: {
            type: string
            met?: boolean
            failed?: boolean
            paused?: boolean
            condition?: string
          }
        })
      | undefined
    if (!m || m.type !== 'attachment') continue
    if (m.attachment?.type !== 'goal_status') continue
    if (m.attachment.met || m.attachment.failed) return null
    const condition = m.attachment.condition
    return condition ? { condition, paused: m.attachment.paused === true } : null
  }
  return null
}

export function findGoalToRestore(messages: Message[]): string | null {
  const state = findGoalRestoreState(messages)
  return state && !state.paused ? state.condition : null
}

/**
 * Ant `Qp3` (5036.js). Re-establish activeGoal + Stop hook from a resumed
 * session's message log:
 *   - If `findGoalToRestore` returns a condition → install the same Stop
 *     hook (matcher='', type='prompt'), set activeGoal{condition,
 *     iterations:0 (counter resets across resume), setAt:now}, fire
 *     `tengu_goal_restored_on_resume {promptLength}`.
 *   - If it returns null → clear activeGoal if it was somehow set in
 *     the resumed initial state.
 *
 * This is invoked from session restore exactly when the feature flag is
 * on (see ant HoH() guard in 5037.js E0_/cP6).
 */
export function restoreGoalFromTranscript(
  messages: Message[],
  setAppState: (updater: (prev: any) => any) => void,
  sessionId: string,
): void {
  const restore = findGoalRestoreState(messages)
  if (restore === null) {
    setAppState(prev =>
      prev.activeGoal === undefined ? prev : { ...prev, activeGoal: undefined },
    )
    return
  }
  const { condition, paused } = restore
  // ant v2.1.142 n06: re-check gates on restore — hooks or trust may have
  // changed since the goal was originally set. Restore-path gate excludes
  // the trust check (trust dialog runs before restore and a restored
  // transcript inherits the session's trust state).
  if (!paused && isGoalBlockedByHooksGate()) {
    logEvent('tengu_feature_sad', {
      feature_name: 'goal_set' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code: 'hooks_gate' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    setAppState(prev =>
      prev.activeGoal === undefined ? prev : { ...prev, activeGoal: undefined },
    )
    return
  }
  if (!paused) {
    addSessionHook(setAppState, sessionId, 'Stop', '', {
      type: 'prompt',
      prompt: condition,
    })
  }
  setAppState(prev => ({
    ...prev,
    activeGoal: {
      condition,
      iterations: 0,
      setAt: Date.now(),
      tokensAtStart: getTotalOutputTokens(),
      paused,
    } satisfies ActiveGoal,
  }))
  logEvent('tengu_goal_restored_on_resume', { promptLength: condition.length })
}

// ─── helpers ────────────────────────────────────────────────────────────

function pluralize(n: number, base: string): string {
  return n === 1 ? base : `${base}s`
}

/**
 * Compact token formatter — matches ant `r4()`. Formats cumulative
 * output tokens in human-readable form (e.g. "2.3k", "1.2M").
 */
export function formatTokensCompact(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

/**
 * Compact duration formatter — matches ant `_K(ms, {mostSignificantOnly:true})`.
 * Shows the largest unit only: `1h`, `42m`, `13s`, `120ms`.
 */
export function formatDurationCompact(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  return `${h}h`
}

/**
 * Relative date — "5m ago" / "2h ago" / "3d ago" / falls back to a short
 * date for older items. Mirrors ant EV() compact format.
 */
function formatRelativeDate(d: Date): string {
  const diffMs = Date.now() - d.getTime()
  if (diffMs < 60_000) return 'just now'
  if (diffMs < 3_600_000) {
    return `${Math.round(diffMs / 60_000)}m ago`
  }
  if (diffMs < 86_400_000) {
    return `${Math.round(diffMs / 3_600_000)}h ago`
  }
  if (diffMs < 7 * 86_400_000) {
    return `${Math.round(diffMs / 86_400_000)}d ago`
  }
  return d.toISOString().slice(0, 10)
}
