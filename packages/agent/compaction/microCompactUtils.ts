/**
 *
 */

/**
 */
export function collectCompactableToolIds(
  messages: Array<{ type: string; message?: { content?: unknown } }>,
  toolNames: Set<string>,
): string[] {
  const ids: string[] = []
  for (const message of messages) {
    if (message.type === 'assistant' && Array.isArray(message.message?.content)) {
      for (const block of message.message.content as Array<Record<string, unknown>>) {
        if (
          block.type === 'tool_use' &&
          typeof block.name === 'string' &&
          toolNames.has(block.name)
        ) {
          ids.push(block.id as string)
        }
      }
    }
  }
  return ids
}
