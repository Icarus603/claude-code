/**
 * Codex API client — sends requests to chatgpt.com/backend-api/codex/responses
 * using OpenAI Responses API format, authenticated via Codex OAuth JWT.
 */
import {
  getCodexOAuthTokens,
  checkAndRefreshCodexTokenIfNeeded,
} from '../oauth/codex-auth.js'
import { CODEX_AUTHORIZE_URL } from '../oauth/codex-constants.js'
import type {
  BetaMessageParam,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { adaptCodexStreamToAnthropic } from './streamAdapter.js'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex/responses'

// ── Request Types ────────────────────────────────────────────────────────

type CodexRequestInput =
  | { role: 'user' | 'assistant'; content: string | unknown[] }
  | { type: 'function_call_output'; call_id: string; output: string }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'message'; role: 'assistant'; content: unknown[]; status: 'completed' }

type CodexTool = {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
  strict: null
}

// ── Message Translation ──────────────────────────────────────────────────

function translateAnthropicTools(tools: BetaToolUnion[]): CodexTool[] {
  return tools.map(tool => {
    const t = tool as unknown as {
      name: string
      description?: string
      input_schema?: Record<string, unknown>
    }
    return {
      type: 'function',
      name: t.name,
      description: t.description || '',
      parameters: t.input_schema || { type: 'object', properties: {} },
      strict: null,
    }
  })
}

function translateAnthropicMessages(
  messages: BetaMessageParam[],
): CodexRequestInput[] {
  const codexInput: CodexRequestInput[] = []
  let toolCallCounter = 0

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      codexInput.push({ role: msg.role as 'user' | 'assistant', content: msg.content })
      continue
    }

    if (!Array.isArray(msg.content)) continue

    if (msg.role === 'user') {
      const contentArr: Record<string, unknown>[] = []
      for (const block of msg.content) {
        const b = block as Record<string, unknown> & {
          type: string
          text?: string
          tool_use_id?: string
          content?: string | Record<string, unknown>[]
          source?: { type: string; data: string; media_type: string }
        }
        if (b.type === 'tool_result') {
          const callId = b.tool_use_id || `call_${toolCallCounter++}`
          let outputText = ''
          if (typeof b.content === 'string') {
            outputText = b.content
          } else if (Array.isArray(b.content)) {
            outputText = b.content
              .map((c: Record<string, unknown>) =>
                c.type === 'text' ? (c.text as string) || '' : '',
              )
              .join('\n')
          }
          codexInput.push({
            type: 'function_call_output',
            call_id: callId,
            output: outputText || '',
          })
        } else if (b.type === 'text' && typeof b.text === 'string') {
          contentArr.push({ type: 'input_text', text: b.text })
        } else if (
          b.type === 'image' &&
          b.source?.type === 'base64'
        ) {
          contentArr.push({
            type: 'input_image',
            image_url: `data:${b.source.media_type};base64,${b.source.data}`,
          })
        }
      }
      if (contentArr.length > 0) {
        if (contentArr.length === 1 && contentArr[0].type === 'input_text') {
          codexInput.push({ role: 'user', content: contentArr[0].text })
        } else {
          codexInput.push({ role: 'user', content: contentArr })
        }
      }
    } else {
      for (const block of msg.content) {
        const b = block as Record<string, unknown> & {
          type: string
          text?: string
          id?: string
          name?: string
          input?: Record<string, unknown>
        }
        if (b.type === 'text' && typeof b.text === 'string') {
          codexInput.push({
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: b.text, annotations: [] }],
            status: 'completed',
          })
        } else if (b.type === 'tool_use') {
          const callId = (b.id as string) || `call_${toolCallCounter++}`
          codexInput.push({
            type: 'function_call',
            call_id: callId,
            name: (b.name as string) || '',
            arguments: JSON.stringify(b.input || {}),
          })
        }
      }
    }
  }

  return codexInput
}

// ── Model Mapping ────────────────────────────────────────────────────────

const CLAUDE_TO_CODEX_MODEL: Record<string, string> = {
  opus: 'gpt-5.1-codex-max',
  sonnet: 'gpt-5.2-codex',
  haiku: 'gpt-5.1-codex-mini',
}

function mapClaudeModelToCodex(model: string): string {
  // If already a codex model, use as-is
  if (
    model.startsWith('gpt-5.') ||
    model.startsWith('o3') ||
    model.startsWith('o4')
  ) {
    return model
  }
  const lower = model.toLowerCase()
  if (lower.includes('opus')) return CLAUDE_TO_CODEX_MODEL['opus']!
  if (lower.includes('haiku')) return CLAUDE_TO_CODEX_MODEL['haiku']!
  if (lower.includes('sonnet')) return CLAUDE_TO_CODEX_MODEL['sonnet']!
  return 'gpt-5.2-codex'
}

// ── Effort Mapping ───────────────────────────────────────────────────────

function mapEffortToReasoningEffort(
  effort?: string,
): string | undefined {
  if (!effort) return undefined
  switch (effort) {
    case 'high':
      return 'high'
    case 'medium':
      return 'medium'
    case 'low':
      return 'low'
    default:
      return undefined
  }
}

// ── API Call ─────────────────────────────────────────────────────────────

export type CodexQueryParams = {
  messages: BetaMessageParam[]
  system?: string | Array<{ type: string; text?: string }>
  model: string
  tools?: BetaToolUnion[]
  maxTokens?: number
  temperature?: number
  outputConfig?: { effort?: string }
  speed?: string
}

/**
 * Call the Codex Responses API and yield Anthropic-format stream events.
 * Handles token refresh automatically.
 */
export async function* queryCodex(
  params: CodexQueryParams,
): AsyncGenerator<BetaRawMessageStreamEvent, void> {
  // Ensure we have a valid access token
  const token = await checkAndRefreshCodexTokenIfNeeded()
  if (!token) {
    throw new Error(
      'No Codex OAuth token available. Please login with /login → OpenAI Codex account.',
    )
  }

  // Get account ID from stored tokens
  const tokens = getCodexOAuthTokens()
  const accountId = tokens?.accountId || ''

  const codexModel = mapClaudeModelToCodex(params.model)

  // Build instructions from system prompt
  let instructions = ''
  if (params.system) {
    instructions =
      typeof params.system === 'string'
        ? params.system
        : params.system
            .filter(b => b.type === 'text' && typeof b.text === 'string')
            .map(b => b.text!)
            .join('\n')
  }

  // Translate messages
  const input = translateAnthropicMessages(params.messages)

  // Build request body
  const body: Record<string, unknown> = {
    model: codexModel,
    store: false,
    stream: true,
    instructions,
    input,
    tool_choice: 'auto',
    parallel_tool_calls: true,
  }

  // Add reasoning effort
  const effort = params.outputConfig?.effort
  const reasoningEffort = mapEffortToReasoningEffort(effort)
  if (reasoningEffort) {
    body.reasoning = { effort: reasoningEffort }
  }

  // Add speed mode
  if (params.speed === 'fast') {
    body.service_tier = 'priority'
  }

  // Add tools
  if (params.tools && params.tools.length > 0) {
    body.tools = translateAnthropicTools(params.tools)
  }

  // Make the request
  const response = await fetch(CODEX_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${token}`,
      'chatgpt-account-id': accountId,
      originator: 'pi',
      'OpenAI-Beta': 'responses=experimental',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(
      `Codex API error (${response.status}): ${errorText.slice(0, 500)}`,
    )
  }

  // Stream the response with translation
  if (!response.body) {
    throw new Error('Codex API returned no response body')
  }

  yield* adaptCodexStreamToAnthropic(response.body, codexModel)
}
