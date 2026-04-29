/**
 * Codex fetch adapter.
 *
 * Architecture (mirrors openai/codex's wire format and the
 * `my-claude-code` reference impl): instead of routing Codex requests
 * through a parallel `getProviderAdapter('codex')` branch, we install a
 * custom `fetch` on the Anthropic SDK client when the active connection
 * is Codex. The SDK does its normal `messages.create({...})` flow,
 * which calls `fetch('/v1/messages', { body: <Anthropic body> })`. Our
 * fetch intercepts that, translates the Anthropic body to Codex's
 * `/responses` shape, calls `https://chatgpt.com/backend-api/codex/responses`,
 * and translates the SSE response back to Anthropic events.
 *
 * Why this layer (and not a separate adapter/queryStream branch):
 *   • The Anthropic SDK already normalizes everything (system prompts,
 *     tools, output_config.effort, BetaMessageParam[]) into the wire
 *     body before fetch is called. We get a clean Anthropic-shape input
 *     instead of the upstream `Message[]` wrapper that broke our prior
 *     queryStream-level translator (`msg.content` undefined → empty
 *     `input` → 400 "missing input").
 *   • Errors come back as `Response` objects, which the SDK already
 *     converts into proper `APIError` exceptions. No need to wrap
 *     thrown Errors into `SystemAPIErrorMessage` ourselves.
 *   • One impedance-match seam, not three.
 */
import type { ClientOptions } from '@anthropic-ai/sdk'
import {
  checkAndRefreshCodexTokenIfNeeded,
  getCodexOAuthTokens,
} from '../oauth/codex-auth.js'

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex/responses'

// ── Effort mapping ──────────────────────────────────────────────────

/**
 * Map our user-facing EffortLevel to Codex's `ReasoningEffort` enum.
 * `xhigh` passes through (Codex supports it natively); `max` is
 * Anthropic-specific and clamps down to `xhigh` so the request still
 * goes out with the strongest reasoning the model offers.
 */
function mapEffortToReasoningEffort(effort?: string): string | undefined {
  if (!effort) return undefined
  switch (effort) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return effort
    case 'max':
      return 'xhigh'
    default:
      return undefined
  }
}

// ── Anthropic body shapes (subset we touch) ─────────────────────────

interface AnthropicContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string | AnthropicContentBlock[]
  source?: { type?: string; data?: string; media_type?: string }
  [key: string]: unknown
}

interface AnthropicMessage {
  role: string
  content: string | AnthropicContentBlock[]
}

interface AnthropicTool {
  name: string
  description?: string
  input_schema?: Record<string, unknown>
}

// ── Anthropic → Codex tool translation ──────────────────────────────

function translateTools(
  anthropicTools: AnthropicTool[],
): Array<Record<string, unknown>> {
  return anthropicTools.map(tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description ?? '',
    parameters: tool.input_schema ?? { type: 'object', properties: {} },
    strict: null,
  }))
}

// ── Anthropic → Codex input translation ─────────────────────────────

function translateMessages(
  anthropicMessages: AnthropicMessage[],
): Array<Record<string, unknown>> {
  const codexInput: Array<Record<string, unknown>> = []
  let toolCallCounter = 0

  for (const msg of anthropicMessages) {
    if (typeof msg.content === 'string') {
      codexInput.push({
        type: 'message',
        role: msg.role,
        content: [
          {
            type: msg.role === 'assistant' ? 'output_text' : 'input_text',
            text: msg.content,
            ...(msg.role === 'assistant' ? { annotations: [] } : {}),
          },
        ],
      })
      continue
    }
    if (!Array.isArray(msg.content)) continue

    if (msg.role === 'user') {
      const contentArr: Array<Record<string, unknown>> = []
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          const callId = block.tool_use_id ?? `call_${toolCallCounter++}`
          let outputText = ''
          if (typeof block.content === 'string') {
            outputText = block.content
          } else if (Array.isArray(block.content)) {
            outputText = block.content
              .map(c => {
                if (c.type === 'text') return c.text ?? ''
                if (c.type === 'image') return '[Image data attached]'
                return ''
              })
              .join('\n')
          }
          codexInput.push({
            type: 'function_call_output',
            call_id: callId,
            output: outputText,
          })
        } else if (block.type === 'text' && typeof block.text === 'string') {
          contentArr.push({ type: 'input_text', text: block.text })
        } else if (
          block.type === 'image' &&
          block.source?.type === 'base64' &&
          typeof block.source.data === 'string' &&
          typeof block.source.media_type === 'string'
        ) {
          contentArr.push({
            type: 'input_image',
            image_url: `data:${block.source.media_type};base64,${block.source.data}`,
          })
        }
      }
      if (contentArr.length > 0) {
        codexInput.push({
          type: 'message',
          role: 'user',
          content: contentArr,
        })
      }
    } else {
      for (const block of msg.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          codexInput.push({
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'output_text', text: block.text, annotations: [] },
            ],
          })
        } else if (block.type === 'tool_use') {
          const callId = block.id ?? `call_${toolCallCounter++}`
          codexInput.push({
            type: 'function_call',
            call_id: callId,
            name: block.name ?? '',
            arguments: JSON.stringify(block.input ?? {}),
          })
        }
      }
    }
  }
  return codexInput
}

// ── Anthropic body → Codex body ─────────────────────────────────────

export function translateToCodexBody(
  anthropicBody: Record<string, unknown>,
): { codexBody: Record<string, unknown>; codexModel: string } {
  const anthropicMessages = (anthropicBody.messages ?? []) as AnthropicMessage[]
  const systemPrompt = anthropicBody.system as
    | string
    | Array<{ type: string; text?: string }>
    | undefined
  const claudeModel = (anthropicBody.model ?? '') as string
  const anthropicTools = (anthropicBody.tools ?? []) as AnthropicTool[]
  const outputConfig = anthropicBody.output_config as
    | { effort?: unknown }
    | undefined

  // Codex slugs come from getDefaultModelsForProtocol('codex') already —
  // model id flows through queryModel's prefix-strip and into
  // options.model verbatim, so claudeModel here is the bare codex slug
  // (e.g. 'gpt-5.5'). No further mapping needed.
  const codexModel = claudeModel

  const reasoningEffort = mapEffortToReasoningEffort(
    typeof outputConfig?.effort === 'string' ? outputConfig.effort : undefined,
  )

  const instructions = systemPrompt
    ? typeof systemPrompt === 'string'
      ? systemPrompt
      : Array.isArray(systemPrompt)
        ? systemPrompt
            .filter(b => b.type === 'text' && typeof b.text === 'string')
            .map(b => b.text!)
            .join('\n')
        : ''
    : ''

  const input = translateMessages(anthropicMessages)
  const tools = anthropicTools.length > 0 ? translateTools(anthropicTools) : []
  const reasoning = reasoningEffort ? { effort: reasoningEffort } : null
  const include = reasoning ? ['reasoning.encrypted_content'] : []

  // codex-rs `ResponsesApiRequest` shape (codex-api/src/common.rs).
  // `tools`, `include`, `parallel_tool_calls`, `reasoning` (as null) are
  // all required on the wire — omitting any of them makes the gateway
  // reject with a misleading "missing input" error.
  const codexBody: Record<string, unknown> = {
    model: codexModel,
    instructions,
    input,
    tools,
    tool_choice: 'auto',
    parallel_tool_calls: true,
    reasoning,
    store: false,
    stream: true,
    include,
  }

  return { codexBody, codexModel }
}

// ── Codex SSE → Anthropic SSE translation ───────────────────────────

function formatSSE(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`
}

async function translateCodexStreamToAnthropic(
  codexResponse: Response,
  codexModel: string,
): Promise<Response> {
  const messageId = `msg_codex_${Date.now()}`
  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let contentBlockIndex = 0
      let outputTokens = 0
      let inputTokens = 0
      let currentTextBlockStarted = false
      let inToolCall = false
      let inReasoningBlock = false
      let hadToolCalls = false

      const send = (event: string, data: object): void => {
        controller.enqueue(encoder.encode(formatSSE(event, JSON.stringify(data))))
      }

      send('message_start', {
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
      })
      send('ping', { type: 'ping' })

      try {
        const reader = codexResponse.body?.getReader()
        if (!reader) {
          throw new Error('Codex response has no body')
        }
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith('event: ')) continue
            if (!trimmed.startsWith('data: ')) continue
            const dataStr = trimmed.slice(6)
            if (dataStr === '[DONE]') continue
            let event: Record<string, unknown>
            try {
              event = JSON.parse(dataStr)
            } catch {
              continue
            }
            const eventType = event.type as string

            if (eventType === 'response.output_item.added') {
              const item = event.item as Record<string, unknown>
              if (item?.type === 'reasoning') {
                // INTENTIONALLY do not emit a `thinking` content block
                // for Codex reasoning. Anthropic API requires thinking
                // blocks to carry a non-empty `thinking` string AND a
                // signature; Codex provides neither. Persisting one in
                // the message history causes Claude API to 400 with
                // "messages.N.content.0.thinking: each thinking block
                // must contain thinking" the moment the user switches
                // back to a Claude model. Reasoning is dropped from
                // assistant content entirely; the visible answer
                // arrives via `response.output_text.delta`.
                inReasoningBlock = true
              } else if (item?.type === 'function_call') {
                if (currentTextBlockStarted) {
                  send('content_block_stop', {
                    type: 'content_block_stop',
                    index: contentBlockIndex,
                  })
                  contentBlockIndex++
                  currentTextBlockStarted = false
                }
                inToolCall = true
                hadToolCalls = true
                send('content_block_start', {
                  type: 'content_block_start',
                  index: contentBlockIndex,
                  content_block: {
                    type: 'tool_use',
                    id: (item.call_id as string) || `toolu_${Date.now()}`,
                    name: (item.name as string) || '',
                    input: {},
                  },
                })
              }
            } else if (eventType === 'response.output_text.delta') {
              const text = event.delta as string
              if (typeof text === 'string' && text.length > 0) {
                if (!currentTextBlockStarted) {
                  send('content_block_start', {
                    type: 'content_block_start',
                    index: contentBlockIndex,
                    content_block: { type: 'text', text: '' },
                  })
                  currentTextBlockStarted = true
                }
                send('content_block_delta', {
                  type: 'content_block_delta',
                  index: contentBlockIndex,
                  delta: { type: 'text_delta', text },
                })
                outputTokens += 1
              }
            } else if (eventType === 'response.reasoning.delta') {
              // Drop reasoning deltas — see the comment on
              // `response.output_item.added` reasoning branch above for
              // why we don't surface them as thinking blocks.
            } else if (eventType === 'response.function_call_arguments.delta') {
              const argDelta = event.delta as string
              if (typeof argDelta === 'string' && inToolCall) {
                send('content_block_delta', {
                  type: 'content_block_delta',
                  index: contentBlockIndex,
                  delta: { type: 'input_json_delta', partial_json: argDelta },
                })
              }
            } else if (eventType === 'response.output_item.done') {
              const item = event.item as Record<string, unknown>
              if (item?.type === 'function_call') {
                send('content_block_stop', {
                  type: 'content_block_stop',
                  index: contentBlockIndex,
                })
                contentBlockIndex++
                inToolCall = false
              } else if (item?.type === 'message') {
                if (currentTextBlockStarted) {
                  send('content_block_stop', {
                    type: 'content_block_stop',
                    index: contentBlockIndex,
                  })
                  contentBlockIndex++
                  currentTextBlockStarted = false
                }
              } else if (item?.type === 'reasoning') {
                // Reasoning is dropped — no content block was opened,
                // so nothing to close. Just clear the flag.
                inReasoningBlock = false
              }
            } else if (eventType === 'response.completed') {
              const response = event.response as Record<string, unknown>
              const usage = response?.usage as
                | Record<string, number>
                | undefined
              if (usage) {
                outputTokens = usage.output_tokens ?? outputTokens
                inputTokens = usage.input_tokens ?? inputTokens
              }
            }
          }
        }
      } catch (err) {
        if (!currentTextBlockStarted) {
          send('content_block_start', {
            type: 'content_block_start',
            index: contentBlockIndex,
            content_block: { type: 'text', text: '' },
          })
          currentTextBlockStarted = true
        }
        send('content_block_delta', {
          type: 'content_block_delta',
          index: contentBlockIndex,
          delta: {
            type: 'text_delta',
            text: `\n\n[Error: ${err instanceof Error ? err.message : String(err)}]`,
          },
        })
      }

      // Close any block we actually opened. `inReasoningBlock` only
      // tracks server-side state for skipping reasoning deltas — no
      // content block was emitted for it, so it never needs a stop.
      if (currentTextBlockStarted || inToolCall) {
        send('content_block_stop', {
          type: 'content_block_stop',
          index: contentBlockIndex,
        })
      }

      const stopReason = hadToolCalls ? 'tool_use' : 'end_turn'
      send('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: outputTokens },
      })
      send('message_stop', {
        type: 'message_stop',
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      })
      controller.close()
    },
  })

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'x-request-id': messageId,
    },
  })
}

// ── Public: build the SDK fetch override ───────────────────────────

/**
 * Returns a `fetch` impl that intercepts `/v1/messages` requests,
 * translates the Anthropic body to Codex shape, and translates the
 * Codex SSE response back to Anthropic SSE. All other URLs pass through
 * to the global fetch unchanged so SDK-internal traffic (OAuth refresh,
 * etc.) isn't affected.
 */
export function createCodexFetch(): ClientOptions['fetch'] {
  return async (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url
    if (!url.includes('/v1/messages')) {
      return globalThis.fetch(input as RequestInfo, init)
    }

    let anthropicBody: Record<string, unknown>
    try {
      const bodyText =
        init?.body instanceof ReadableStream
          ? await new Response(init.body).text()
          : typeof init?.body === 'string'
            ? init.body
            : '{}'
      anthropicBody = JSON.parse(bodyText)
    } catch {
      anthropicBody = {}
    }

    const accessToken = await checkAndRefreshCodexTokenIfNeeded()
    const tokens = getCodexOAuthTokens()
    if (!accessToken || !tokens?.accountId) {
      const errorBody = {
        type: 'error',
        error: {
          type: 'authentication_error',
          message: 'Codex OAuth tokens are missing — /login → ChatGPT Codex',
        },
      }
      return new Response(JSON.stringify(errorBody), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { codexBody, codexModel } = translateToCodexBody(anthropicBody)

    const codexResponse = await globalThis.fetch(CODEX_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${accessToken}`,
        'chatgpt-account-id': tokens.accountId,
        originator: 'pi',
        'OpenAI-Beta': 'responses=experimental',
      },
      body: JSON.stringify(codexBody),
      // Forward the SDK's AbortSignal so query cancellation / timeouts propagate.
      // Without this, the upstream cannot cancel an in-flight Codex request.
      signal: init?.signal ?? null,
    })

    if (!codexResponse.ok) {
      const errorText = await codexResponse.text().catch(() => '')
      return new Response(
        JSON.stringify({
          type: 'error',
          error: {
            type: 'api_error',
            message: `Codex API error (${codexResponse.status}): ${errorText.slice(0, 500)}`,
          },
        }),
        {
          status: codexResponse.status,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    return translateCodexStreamToAnthropic(codexResponse, codexModel)
  }
}
