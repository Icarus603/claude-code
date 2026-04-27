/**
 * Translates OpenAI Responses API SSE stream to Anthropic BetaRawMessageStreamEvent.
 *
 * Codex Responses API events and their Anthropic equivalents:
 *   response.output_item.added (message)       → (no direct event, prepares text block)
 *   response.output_item.added (reasoning)     → content_block_start (thinking)
 *   response.output_item.added (function_call) → content_block_start (tool_use)
 *   response.output_text.delta                 → content_block_delta (text_delta)
 *   response.reasoning.delta                   → content_block_delta (thinking_delta)
 *   response.function_call_arguments.delta     → content_block_delta (input_json_delta)
 *   response.output_item.done                  → content_block_stop
 *   response.completed                         → message_delta + message_stop
 */
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

// ── SSE Parsing ──────────────────────────────────────────────────────────

async function* parseSSEEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>, void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('event: ')) continue
        if (!trimmed.startsWith('data: ')) continue

        const dataStr = trimmed.slice(6)
        if (dataStr === '[DONE]') continue

        try {
          yield JSON.parse(dataStr) as Record<string, unknown>
        } catch {
          // Skip malformed events
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ── Event Translation ────────────────────────────────────────────────────

export async function* adaptCodexStreamToAnthropic(
  body: ReadableStream<Uint8Array>,
  codexModel: string,
): AsyncGenerator<BetaRawMessageStreamEvent, void> {
  const messageId = `msg_codex_${Date.now()}`

  // Emit message_start
  yield {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: codexModel,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  }

  let contentBlockIndex = 0
  let currentTextBlockStarted = false
  let inToolCall = false
  let currentToolCallId = ''
  let currentToolCallName = ''
  let inReasoningBlock = false
  let hadToolCalls = false
  let outputTokens = 0
  let inputTokens = 0

  for await (const event of parseSSEEvents(body)) {
    const eventType = event.type as string

    // ── Output item added ──────────────────────────────
    if (eventType === 'response.output_item.added') {
      const item = event.item as Record<string, unknown>
      if (item?.type === 'reasoning') {
        inReasoningBlock = true
        yield makeContentBlockStart(contentBlockIndex, {
          type: 'thinking',
          thinking: '',
        })
      } else if (item?.type === 'function_call') {
        // Close text block if open
        if (currentTextBlockStarted) {
          yield makeContentBlockStop(contentBlockIndex)
          contentBlockIndex++
          currentTextBlockStarted = false
        }

        currentToolCallId = (item.call_id as string) || `toolu_${Date.now()}`
        currentToolCallName = (item.name as string) || ''
        inToolCall = true
        hadToolCalls = true

        yield makeContentBlockStart(contentBlockIndex, {
          type: 'tool_use',
          id: currentToolCallId,
          name: currentToolCallName,
          input: {},
        })
      }
    }

    // ── Text delta ─────────────────────────────────────
    else if (eventType === 'response.output_text.delta') {
      const text = event.delta as string
      if (typeof text === 'string' && text.length > 0) {
        if (!currentTextBlockStarted) {
          yield makeContentBlockStart(contentBlockIndex, {
            type: 'text',
            text: '',
          })
          currentTextBlockStarted = true
        }
        yield {
          type: 'content_block_delta',
          index: contentBlockIndex,
          delta: { type: 'text_delta', text },
        }
        outputTokens += 1
      }
    }

    // ── Reasoning delta ────────────────────────────────
    else if (eventType === 'response.reasoning.delta') {
      const text = event.delta as string
      if (typeof text === 'string' && text.length > 0) {
        if (!inReasoningBlock) {
          inReasoningBlock = true
          yield makeContentBlockStart(contentBlockIndex, {
            type: 'thinking',
            thinking: '',
          })
        }
        yield {
          type: 'content_block_delta',
          index: contentBlockIndex,
          delta: { type: 'thinking_delta', thinking: text },
        }
        outputTokens += 1
      }
    }

    // ── Function call arguments delta ──────────────────
    else if (eventType === 'response.function_call_arguments.delta') {
      const argDelta = event.delta as string
      if (typeof argDelta === 'string' && inToolCall) {
        yield {
          type: 'content_block_delta',
          index: contentBlockIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: argDelta,
          },
        }
      }
    }

    // ── Output item done ───────────────────────────────
    else if (eventType === 'response.output_item.done') {
      const item = event.item as Record<string, unknown>
      if (item?.type === 'function_call') {
        yield makeContentBlockStop(contentBlockIndex)
        contentBlockIndex++
        inToolCall = false
      } else if (item?.type === 'message') {
        if (currentTextBlockStarted) {
          yield makeContentBlockStop(contentBlockIndex)
          contentBlockIndex++
          currentTextBlockStarted = false
        }
      } else if (item?.type === 'reasoning') {
        if (inReasoningBlock) {
          yield makeContentBlockStop(contentBlockIndex)
          contentBlockIndex++
          inReasoningBlock = false
        }
      }
    }

    // ── Response completed ─────────────────────────────
    else if (eventType === 'response.completed') {
      const response = event.response as Record<string, unknown>
      const usage = response?.usage as
        | Record<string, number>
        | undefined
      if (usage) {
        outputTokens = usage.output_tokens || outputTokens
        inputTokens = usage.input_tokens || inputTokens
      }
    }
  }

  // Close any remaining blocks
  if (currentTextBlockStarted) {
    yield makeContentBlockStop(contentBlockIndex)
  }
  if (inReasoningBlock) {
    yield makeContentBlockStop(contentBlockIndex)
  }
  if (inToolCall) {
    yield makeContentBlockStop(contentBlockIndex)
  }

  // Emit message_delta + message_stop
  const stopReason = hadToolCalls ? 'tool_use' : 'end_turn'
  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  }
  yield {
    type: 'message_stop',
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  } as BetaRawMessageStreamEvent
}

// ── Helpers ──────────────────────────────────────────────────────────────

function makeContentBlockStart(
  index: number,
  contentBlock: Record<string, unknown>,
): BetaRawMessageStreamEvent {
  return {
    type: 'content_block_start',
    index,
    content_block: contentBlock as BetaRawMessageStreamEvent['content_block'],
  }
}

function makeContentBlockStop(index: number): BetaRawMessageStreamEvent {
  return { type: 'content_block_stop', index }
}
