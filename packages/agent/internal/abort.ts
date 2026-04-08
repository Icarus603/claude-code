
import type { CoreContentBlock, CoreMessage } from '../types/messages.js'

/**
 */
export function createSyntheticToolResults(
  messages: CoreMessage[],
  abortReason: string = 'interrupted',
): CoreContentBlock[] {
  const results: CoreContentBlock[] = []

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.type === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (
          typeof block === 'object' &&
          block !== null &&
          'type' in block &&
          block.type === 'tool_use' &&
          'id' in block
        ) {
          results.push({
            type: 'tool_result',
            tool_use_id: block.id as string,
            content: `[${abortReason}] Tool execution was interrupted`,
            is_error: true,
          })
        }
      }
      break
    }
  }

  return results
}

/**
 */
export function shouldAbort(signal?: AbortSignal): boolean {
  return signal?.aborted ?? false
}
