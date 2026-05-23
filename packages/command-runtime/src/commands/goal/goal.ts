/**
 * `/goal` local-jsx command body — port of ant v2.1.142 4752.js (vVK).
 *
 * Behaviour:
 *   - empty args → render current goal status (or "no goal set" + last
 *     met goal line); read-only. Includes token stats (v2.1.142 delta).
 *   - clear keyword (clear / stop / off / reset / none / cancel,
 *     case-insensitive) → clear the active /goal Stop hook.
 *   - other → set a new goal subject to GOAL_CONDITION_MAX_LENGTH.
 *
 * Set path returns shouldQuery:true + metaMessages so the agent
 * immediately picks up the new instruction without the user typing
 * anything more. Clear / status / over-limit paths return a single
 * system message.
 *
 * TODO: wire GoalPanel component for the empty-args case (ant NVK).
 * The component exists at repl/components/goal/GoalPanel.tsx but the
 * command-runtime → repl cross-package export needs wiring first.
 */
import {
  getIsNonInteractiveSession,
  getSessionId,
} from '@claude-code/app-host/bootstrap/state.js'
import { checkHasTrustDialogAccepted } from '@claude-code/config'
import type { LocalJSXCommandOnDone } from '@claude-code/agent/command.js'
import {
  addGoalStopHook,
  buildGoalMetaMessage,
  checkGoalSetGate,
  clearGoalStopHook,
  GOAL_CONDITION_MAX_LENGTH,
  isGoalClearKeyword,
  pauseGoalStopHook,
  renderActiveGoalStatus,
  resumeGoalStopHook,
} from '@claude-code/agent/goalStopHook.js'
import type { Message } from '@claude-code/agent/messageShapes'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '@claude-code/local-observability'

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: {
    getAppState: () => { activeGoal?: { condition: string; iterations: number; setAt: number; tokensAtStart: number; lastReason?: string; paused?: boolean } }
    setAppState: (updater: (prev: any) => any) => void
    setMessages: (updater: (prev: any[]) => any[]) => void
    messages?: Message[]
  },
  args: string,
): Promise<null> {
  const trimmed = (args ?? '').trim()
  const ctx = {
    getAppState: context.getAppState as () => any,
    setAppState: context.setAppState,
    setMessages: context.setMessages,
    sessionId: getSessionId(),
    getMessages: () => context.messages ?? [],
  }

  if (trimmed === '') {
    // ant v2.1.142 vVK: render goal status. Currently uses text-based
    // renderActiveGoalStatus (which includes tokens stat from v2.1.142).
    // TODO: wire GoalPanel interactive component from repl.
    onDone(
      renderActiveGoalStatus(
        context.getAppState().activeGoal,
        context.messages ?? [],
      ),
      { display: 'system' },
    )
    return null
  }

  if (isGoalClearKeyword(trimmed)) {
    const prior = clearGoalStopHook(ctx)
    onDone(prior === null ? 'No goal set' : `Goal cleared: ${prior}`, {
      display: 'system',
    })
    return null
  }

  if (trimmed.toLowerCase() === 'pause') {
    const prior = pauseGoalStopHook(ctx)
    onDone(prior === null ? 'No goal set' : `Goal paused: ${prior}`, {
      display: 'system',
    })
    return null
  }

  if (trimmed.toLowerCase() === 'resume') {
    const prior = resumeGoalStopHook(ctx)
    onDone(prior === null ? 'No goal set' : `Goal resumed: ${prior}`, {
      display: 'system',
      ...(prior === null
        ? {}
        : { shouldQuery: true, metaMessages: [buildGoalMetaMessage(prior)] }),
    })
    return null
  }

  // ant v2.1.142 baH/PB8: gate /goal behind hooks-enabled AND trust-accepted.
  // /goal installs a Stop hook; if hooks can't fire, the goal hangs.
  // If the workspace isn't trusted, prompt-hook evaluators see untrusted
  // file contents → ant blocks set in interactive sessions until trust accepted.
  const gate = checkGoalSetGate({
    isNonInteractive: getIsNonInteractiveSession,
    hasTrustDialogAccepted: checkHasTrustDialogAccepted,
  })
  if (gate !== null) {
    logEvent('tengu_feature_sad', {
      feature_name: 'goal_set' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code: gate.code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    onDone(gate.message, { display: 'system' })
    return null
  }

  if (trimmed.length > GOAL_CONDITION_MAX_LENGTH) {
    // ant v2.1.139 4705.js:33 — j6("goal_set", "too_long") → emits
    // tengu_feature_sad so over-limit attempts show up in feature-funnel
    // dashboards. Without this the user-error path is invisible to telemetry.
    logEvent('tengu_feature_sad', {
      feature_name:
        'goal_set' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        'too_long' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    onDone(
      `Goal condition is limited to ${GOAL_CONDITION_MAX_LENGTH} characters (got ${trimmed.length})`,
      { display: 'system' },
    )
    return null
  }

  addGoalStopHook(trimmed, ctx)
  onDone(`Goal set: ${trimmed}`, {
    shouldQuery: true,
    metaMessages: [buildGoalMetaMessage(trimmed)],
  })
  return null
}
