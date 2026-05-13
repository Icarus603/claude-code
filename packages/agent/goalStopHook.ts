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
 *   - HoH  → isGoalCommandEnabled (`tengu_maple_tide` flag)
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
import { logEvent } from '@claude-code/local-observability'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { isEnvTruthy, readEnv } from '@claude-code/config/env/utils'
import type { HookCommand } from '@claude-code/config/types'
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
}

/** Most-recent met-goal record, surfaced as "Last: ✔ <cond> — <stats>". */
export type LastMetGoalRecord = {
  condition: string
  stats: string
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
  // 3. Set AppState.activeGoal.
  ctx.setAppState(prev => ({
    ...prev,
    activeGoal: {
      condition,
      iterations: 0,
      setAt: Date.now(),
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
export function clearGoalStopHook(ctx: GoalHookContext): string | null {
  const matches = existingGoalHooks(ctx)
  if (matches.length === 0) return null
  // ant VrH: first hook's prompt is the canonical "condition" used in the
  // cleared message even if more than one goal hook somehow co-existed.
  const first = matches[0]!
  const condition =
    first.type === 'prompt' ? (first as { prompt: string }).prompt : ''
  for (const hook of matches) {
    removeSessionHook(ctx.setAppState, ctx.sessionId, 'Stop', hook)
  }
  ctx.setAppState(prev => ({
    ...prev,
    activeGoal: undefined,
  }))
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
    const att = m.attachment
    if (att?.type !== 'goal_status') continue
    if (!att.met || att.sentinel) continue
    const stats: string[] = []
    if (att.durationMs !== undefined) {
      stats.push(formatDurationCompact(att.durationMs))
    }
    if (att.iterations !== undefined) {
      stats.push(`${att.iterations} ${pluralize(att.iterations, 'turn')}`)
    }
    const ts = (m as { timestamp?: string }).timestamp
    stats.push(formatRelativeDate(ts ? new Date(ts) : new Date()))
    return {
      condition: att.condition ?? '',
      stats: stats.join(' · '),
    }
  }
  return null
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
  const setLine = `set ${formatRelativeDate(new Date(goal.setAt))} · `
  const lines: Array<string | false | undefined> = [
    `● Goal: ${goal.condition}`,
    `${setLine}${iter}`,
    goal.lastReason && formatLastCheck(goal.lastReason),
    '`/goal clear` to remove',
  ]
  return lines.filter(Boolean).join('\n')
}

/**
 * Build the meta-message that nudges the agent when a goal is freshly set.
 * Verbatim ant Gj6 (v2.1.136 4513.js).
 */
export function buildGoalMetaMessage(condition: string): string {
  return `A session-scoped Stop hook is now active with condition: "${condition}". Briefly acknowledge the goal, then immediately start (or continue) working toward it — treat the condition itself as your directive and do not pause to ask the user what to do. The hook will block stopping until the condition holds (clearable via \`/goal clear\`).`
}

// ─── session restore ────────────────────────────────────────────────────

/**
 * Ant `wbK` (5036.js dP6 module). Walk messages backward; return the
 * condition of the LAST goal_status attachment IF that attachment is
 * `met:false`. Returns null when the most recent goal_status is met
 * (= goal completed; nothing to restore) or no goal_status exists.
 *
 * Why "last met:false wins": both sentinel-and-not-sentinel records
 * contribute, but the chronologically-last one determines current state.
 * A `met:true` last record means the goal was either completed
 * (`!sentinel`) or explicitly cleared by `/goal clear` (`sentinel:true`).
 * A `met:false` last record means the goal is still active and waiting.
 */
export function findGoalToRestore(messages: Message[]): string | null {
  if (!messages) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as
      | (Message & {
          type: 'attachment'
          attachment: {
            type: string
            met?: boolean
            condition?: string
          }
        })
      | undefined
    if (!m || m.type !== 'attachment') continue
    if (m.attachment?.type !== 'goal_status') continue
    return m.attachment.met ? null : (m.attachment.condition ?? null)
  }
  return null
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
  const condition = findGoalToRestore(messages)
  if (condition === null) {
    setAppState(prev =>
      prev.activeGoal === undefined ? prev : { ...prev, activeGoal: undefined },
    )
    return
  }
  addSessionHook(setAppState, sessionId, 'Stop', '', {
    type: 'prompt',
    prompt: condition,
  })
  setAppState(prev => ({
    ...prev,
    activeGoal: {
      condition,
      iterations: 0,
      setAt: Date.now(),
    } satisfies ActiveGoal,
  }))
  logEvent('tengu_goal_restored_on_resume', { promptLength: condition.length })
}

// ─── helpers ────────────────────────────────────────────────────────────

function pluralize(n: number, base: string): string {
  return n === 1 ? base : `${base}s`
}

/**
 * Compact duration formatter — matches ant `_K(ms, {mostSignificantOnly:true})`.
 * Shows the largest unit only: `1h`, `42m`, `13s`, `120ms`.
 */
function formatDurationCompact(ms: number): string {
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
