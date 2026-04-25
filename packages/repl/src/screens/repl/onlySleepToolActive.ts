import { SLEEP_TOOL_NAME } from '@claude-code/tool-registry/tools/SleepTool/prompt.js'
import type { Message } from '@claude-code/agent/messageShapes'

/**
 * Returns true iff the last assistant message has in-progress tool_use
 * blocks AND every one of them is the sleep tool. Used to suppress some
 * spinner chrome while a sleep is in flight.
 *
 * V7 §3.3 — extracted from REPLView.tsx (iter 22) as a pure helper so the
 * host doesn't carry inline useMemo logic that depends only on its inputs.
 */
export function isOnlySleepToolActive(
  messages: ReadonlyArray<Message>,
  inProgressToolUseIDs: ReadonlySet<string>,
): boolean {
  const lastAssistant = messages.findLast(m => m.type === 'assistant')
  if (lastAssistant?.type !== 'assistant') return false
  const inProgressToolUses = lastAssistant.message.content.filter(
    b => b.type === 'tool_use' && inProgressToolUseIDs.has(b.id),
  )
  return (
    inProgressToolUses.length > 0 &&
    inProgressToolUses.every(
      b => b.type === 'tool_use' && b.name === SLEEP_TOOL_NAME,
    )
  )
}
