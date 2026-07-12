import type { BetaContentBlock, BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { APIError } from '@anthropic-ai/sdk'
import { createAssistantMessage } from '@claude-code/agent/messages.js'
import type { AssistantMessage } from '@claude-code/agent/messageShapes.js'
import { is529Error } from './withRetry.js'

export class PartialStreamRecovery {
  private readonly completed = new Set<number>()

  reset(): void {
    this.completed.clear()
  }

  complete(index: number): void {
    this.completed.add(index)
  }

  recover(
    partialMessage: BetaMessage | undefined,
    contentBlocks: BetaContentBlock[],
    error: unknown,
  ): AssistantMessage | null {
    if (
      !partialMessage ||
      (!is529Error(error) &&
        (!(error instanceof APIError) ||
          typeof error.status !== 'number' ||
          error.status < 500))
    ) {
      return null
    }
    const text = contentBlocks
      .flatMap((block, index) =>
        !this.completed.has(index) && block.type === 'text' ? [block.text] : [],
      )
      .join('')
    return createAssistantMessage({
      content: `${text}${text ? '\n\n' : ''}[Response incomplete: the server interrupted the stream after partial output.]`,
    })
  }
}
