/**
 * `/goal` local (thinClient / headless) command body — port of ant
 * v2.1.136 4689.js `OZ3`.
 *
 * Behaviour (byte-for-byte ant):
 *   - empty args → text result "Goal active: <cond> (<iter>)\nLast check: <reason>?"
 *     or "No goal set. Usage: `/goal <condition>`".
 *   - clear keyword (clear / stop / off / reset / none / cancel,
 *     case-insensitive) → clear the active goal, return "Goal cleared: <cond>"
 *     (or "No goal set" if there wasn't one).
 *   - over-limit → text error.
 *   - other → set the goal AND return `'query'` result so the agent picks
 *     up the directive immediately (visible "Goal set: ..." + invisible
 *     meta-prompt via Gj6).
 */
import {
  getIsNonInteractiveSession,
  getSessionId,
} from '@claude-code/app-host/bootstrap/state.js'
import { checkHasTrustDialogAccepted } from '@claude-code/config'
import type {
  LocalCommandCall,
  LocalCommandResult,
} from '@claude-code/agent/command.js'
import {
  addGoalStopHook,
  buildGoalMetaMessage,
  checkGoalSetGate,
  clearGoalStopHook,
  formatLastCheck,
  GOAL_CONDITION_MAX_LENGTH,
  isGoalClearKeyword,
} from '@claude-code/agent/goalStopHook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '@claude-code/local-observability'

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`
}

export const call: LocalCommandCall = async (
  args,
  context,
): Promise<LocalCommandResult> => {
  const trimmed = (args ?? '').trim()
  const ctx = {
    getAppState: context.getAppState as () => any,
    setAppState: context.setAppState as (u: (p: any) => any) => void,
    setMessages: context.setMessages as (u: (p: any[]) => any[]) => void,
    sessionId: getSessionId(),
  }

  if (trimmed === '') {
    const goal = context.getAppState().activeGoal as
      | {
          condition: string
          iterations: number
          lastReason?: string
        }
      | undefined
    if (!goal) {
      return {
        type: 'text',
        value: 'No goal set. Usage: `/goal <condition>`',
      }
    }
    const iter = `${goal.iterations} ${plural(goal.iterations, 'iteration')}`
    const reasonLine = goal.lastReason ? `\n${formatLastCheck(goal.lastReason)}` : ''
    return {
      type: 'text',
      value: `Goal active: ${goal.condition} (${iter})${reasonLine}`,
    }
  }

  if (isGoalClearKeyword(trimmed)) {
    const prior = clearGoalStopHook(ctx)
    return {
      type: 'text',
      value: prior === null ? 'No goal set' : `Goal cleared: ${prior}`,
    }
  }

  if (trimmed.length > GOAL_CONDITION_MAX_LENGTH) {
    return {
      type: 'text',
      value: `Goal condition is limited to ${GOAL_CONDITION_MAX_LENGTH} characters (got ${trimmed.length})`,
    }
  }

  // ant v2.1.142 baH/PB8: gate /goal set behind hooks-enabled AND trust-accepted.
  const gate = checkGoalSetGate({
    isNonInteractive: getIsNonInteractiveSession,
    hasTrustDialogAccepted: checkHasTrustDialogAccepted,
  })
  if (gate !== null) {
    logEvent('tengu_feature_sad', {
      feature_name: 'goal_set' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code: gate.code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return { type: 'text', value: gate.message }
  }

  addGoalStopHook(trimmed, ctx)
  return {
    type: 'query',
    value: `Goal set: ${trimmed}`,
    prompt: buildGoalMetaMessage(trimmed),
  }
}
