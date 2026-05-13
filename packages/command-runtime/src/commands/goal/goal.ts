/**
 * `/goal` local-jsx command body — port of ant v2.1.136 4688.js `_Z3`.
 *
 * Behaviour (byte-for-byte ant):
 *   - empty args → render current goal status (or "no goal set" + last
 *     met goal line); read-only.
 *   - clear keyword (clear / stop / off / reset / none / cancel,
 *     case-insensitive) → clear the active /goal Stop hook.
 *   - other → set a new goal subject to GOAL_CONDITION_MAX_LENGTH.
 *
 * Set path returns shouldQuery:true + metaMessages so the agent
 * immediately picks up the new instruction without the user typing
 * anything more. Clear / status / over-limit paths return a single
 * system message.
 */
import { getSessionId } from '@claude-code/app-host/bootstrap/state.js'
import type { LocalJSXCommandOnDone } from '@claude-code/agent/command.js'
import {
  addGoalStopHook,
  buildGoalMetaMessage,
  clearGoalStopHook,
  GOAL_CONDITION_MAX_LENGTH,
  isGoalClearKeyword,
  renderActiveGoalStatus,
} from '@claude-code/agent/goalStopHook.js'
import type { Message } from '@claude-code/agent/messageShapes'

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: {
    getAppState: () => { activeGoal?: { condition: string; iterations: number; setAt: number; lastReason?: string } }
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

  if (trimmed.length > GOAL_CONDITION_MAX_LENGTH) {
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
