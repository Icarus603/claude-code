import { count } from '@claude-code/tool-registry/utils/array.js'
import type { Message, ProgressMessage } from '@claude-code/agent/messageShapes'
import type { HookProgress } from '@claude-code/agent/types/hooks.js'

/**
 * Derive a stop-hook spinner suffix from messages state.
 *
 * Returns null when not loading, no stop-hook progress, or hooks have already
 * settled. Otherwise returns a human-readable suffix like "running stop hook"
 * or "running stop hooks… 2/3".
 *
 * V7 §3.3 — extracted from REPLView.tsx (iter 23) so the host doesn't carry
 * 60+ lines of derive-from-messages logic inline.
 */
export function deriveStopHookSpinnerSuffix(
  messages: ReadonlyArray<Message>,
  isLoading: boolean,
): string | null {
  if (!isLoading) return null

  const progressMsgs = messages.filter(
    (m): m is ProgressMessage<HookProgress> =>
      m.type === 'progress' &&
      m.data.type === 'hook_progress' &&
      (m.data.hookEvent === 'Stop' || m.data.hookEvent === 'SubagentStop'),
  )
  if (progressMsgs.length === 0) return null

  const currentToolUseID = progressMsgs.at(-1)?.toolUseID
  if (!currentToolUseID) return null

  const hasSummaryForCurrentExecution = messages.some(
    m =>
      m.type === 'system' &&
      m.subtype === 'stop_hook_summary' &&
      m.toolUseID === currentToolUseID,
  )
  if (hasSummaryForCurrentExecution) return null

  const currentHooks = progressMsgs.filter(p => p.toolUseID === currentToolUseID)
  const total = currentHooks.length

  const completedCount = count(messages, m => {
    if (m.type !== 'attachment') return false
    const attachment = m.attachment
    return (
      'hookEvent' in attachment &&
      (attachment.hookEvent === 'Stop' ||
        attachment.hookEvent === 'SubagentStop') &&
      'toolUseID' in attachment &&
      attachment.toolUseID === currentToolUseID
    )
  })

  const customMessage = currentHooks.find(p => p.data.statusMessage)?.data
    .statusMessage
  if (customMessage) {
    return total === 1
      ? `${customMessage}…`
      : `${customMessage}… ${completedCount}/${total}`
  }

  const hookType =
    currentHooks[0]?.data.hookEvent === 'SubagentStop'
      ? 'subagent stop'
      : 'stop'

  if (process.env.USER_TYPE === 'ant') {
    const label = total === 1 ? '' : 's'
    return total === 1
      ? `running ${hookType} hook${label}`
      : `running ${hookType} hook${label}… ${completedCount}/${total}`
  }

  return total === 1
    ? `running ${hookType} hook`
    : `running stop hooks… ${completedCount}/${total}`
}
