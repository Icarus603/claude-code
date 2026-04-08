/**
 *
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GroupableMessage = { type: string; message?: { id?: string }; [key: string]: any }

export function groupMessagesByApiRound(messages: GroupableMessage[]): GroupableMessage[][] {
  const groups: GroupableMessage[][] = []
  let current: GroupableMessage[] = []
  let lastAssistantId: string | undefined

  for (const msg of messages) {
    if (
      msg.type === 'assistant' &&
      msg.message?.id !== lastAssistantId &&
      current.length > 0
    ) {
      groups.push(current)
      current = [msg]
    } else {
      current.push(msg)
    }
    if (msg.type === 'assistant') {
      lastAssistantId = msg.message?.id
    }
  }

  if (current.length > 0) {
    groups.push(current)
  }
  return groups
}
