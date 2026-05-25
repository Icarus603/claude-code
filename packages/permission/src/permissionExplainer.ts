/**
 * Permission Explainer
 *
 * One-shot LLM call that explains a pending shell command in a permission
 * confirmation dialog: what it does (`explanation`), why the agent is running
 * it (`reasoning`, starts with "I"), what could go wrong (`risk`, < 15 words),
 * and a `riskLevel` (LOW / MEDIUM / HIGH).
 *
 * Triggered by `ctrl+e` in the Confirmation context. Gated by the global config
 * `permissionExplainerEnabled` — default behaviour (config unset) is enabled,
 * matching ant (`!== false`).
 *
 * Ported from ant v2.1.150 (`PK4` / `E8q` in 5235.js, `eXO` schema + `rXO`
 * enum in 5236.js). The LLM call goes through `sideQuery` (ant `Zx`) with a
 * forced tool_choice, never a full AgentLoop.
 */

import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages.js'
import { z } from 'zod/v4'
import type { Message } from '@claude-code/agent/messageShapes'
import { getGlobalConfig } from '@claude-code/config'
import { sideQuery } from '@claude-code/agent/sideQuery.js'
import { sanitizeToolNameForAnalytics } from '@claude-code/agent/eventMetadata.js'
import { getMainLoopModel } from '@claude-code/provider/model.js'
import { logEvent } from '@claude-code/local-observability'
import { errorMessage } from '@claude-code/local-observability/errorHelpers.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'

const SYSTEM_PROMPT =
  'Analyze shell commands and explain what they do, why you\'re running them, and potential risks.'

// ant rXO — risk level → numeric code for telemetry.
const RISK_LEVEL_CODE = { LOW: 1, MEDIUM: 2, HIGH: 3 } as const

// ant error_type codes (oXO / aXO / sXO).
const ERROR_TYPE_PARSE_FAILED = 1
const ERROR_TYPE_ABORTED = 2
const ERROR_TYPE_API_ERROR = 3

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

export type PermissionExplanation = {
  riskLevel: RiskLevel
  explanation: string
  reasoning: string
  risk: string
}

// ant eXO — the forced-output tool schema.
const EXPLAIN_COMMAND_TOOL: BetaToolUnion = {
  name: 'explain_command',
  description: 'Provide an explanation of a shell command',
  input_schema: {
    type: 'object',
    properties: {
      explanation: {
        type: 'string',
        description: 'What this command does (1-2 sentences)',
      },
      reasoning: {
        type: 'string',
        description:
          'Why YOU are running this command. Start with "I" - e.g. "I need to check the file contents"',
      },
      risk: { type: 'string', description: 'What could go wrong, under 15 words' },
      riskLevel: {
        type: 'string',
        enum: ['LOW', 'MEDIUM', 'HIGH'],
        description:
          'LOW (safe dev workflows), MEDIUM (recoverable changes), HIGH (dangerous/irreversible)',
      },
    },
    required: ['explanation', 'reasoning', 'risk', 'riskLevel'],
  },
}

// ant HPO — validates the tool_use input.
const explanationSchema = z.object({
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  explanation: z.string(),
  reasoning: z.string(),
  risk: z.string(),
})

/**
 * ant E8q — gate. Default (config unset) is enabled.
 */
export function isPermissionExplainerEnabled(): boolean {
  return getGlobalConfig().permissionExplainerEnabled !== false
}

// ant _PO — serialize the tool input for the prompt.
function serializeToolInput(input: unknown): string {
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

// ant qPO — build a short recent-conversation context from the last few
// assistant text blocks (most recent first, capped at maxChars total).
// ccb messages nest their content under `message.content` (vs ant's flat
// MessageParam), so read the assistant turns through that shape.
function buildRecentContext(messages: Message[], maxChars = 1000): string {
  const recentAssistant = messages
    .filter(m => m.type === 'assistant')
    .slice(-3)
  const parts: string[] = []
  let total = 0
  for (const message of [...recentAssistant].reverse()) {
    const content = message.message?.content
    const text = (Array.isArray(content) ? content : [])
      .filter(block => block.type === 'text')
      .map(block => ('text' in block ? block.text : ''))
      .join(' ')
    if (text && total < maxChars) {
      const remaining = maxChars - total
      const slice =
        text.length > remaining ? text.slice(0, remaining) + '...' : text
      parts.unshift(slice)
      total += slice.length
    }
  }
  return parts.join('\n\n')
}

type GeneratePermissionExplanationParams = {
  toolName: string
  toolInput: unknown
  toolDescription?: string
  messages?: Message[]
  signal: AbortSignal
}

/**
 * ant PK4 — the one-shot LLM call. Returns null on any failure (never throws).
 */
export async function generatePermissionExplanation({
  toolName,
  toolInput,
  toolDescription,
  messages = [],
  signal,
}: GeneratePermissionExplanationParams): Promise<PermissionExplanation | null> {
  if (!isPermissionExplainerEnabled()) return null

  const start = Date.now()
  try {
    const serializedInput = serializeToolInput(toolInput)
    const context = messages.length ? buildRecentContext(messages) : ''
    const userPrompt = `Tool: ${toolName}
${toolDescription ? `Description: ${toolDescription}\n` : ''}Input:
${serializedInput}
${context ? `\nRecent conversation context:\n${context}` : ''}

Explain this command in context.`

    const response = await sideQuery({
      model: getMainLoopModel(),
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      tools: [EXPLAIN_COMMAND_TOOL],
      tool_choice: { type: 'tool', name: 'explain_command' },
      signal,
      querySource: 'permission_explainer',
    })

    const latencyMs = Date.now() - start
    logForDebugging(
      `Permission explainer: API returned in ${latencyMs}ms, stop_reason=${response.stop_reason}`,
    )

    const toolUse = response.content.find(block => block.type === 'tool_use')
    if (toolUse && toolUse.type === 'tool_use') {
      const parsed = explanationSchema.safeParse(toolUse.input)
      if (parsed.success) {
        const explanation: PermissionExplanation = {
          riskLevel: parsed.data.riskLevel,
          explanation: parsed.data.explanation,
          reasoning: parsed.data.reasoning,
          risk: parsed.data.risk,
        }
        logEvent('tengu_permission_explainer_generated', {
          tool_name: sanitizeToolNameForAnalytics(toolName),
          risk_level: RISK_LEVEL_CODE[explanation.riskLevel],
          latency_ms: latencyMs,
        })
        logForDebugging(
          `Permission explainer: ${explanation.riskLevel} risk for ${toolName} (${latencyMs}ms)`,
        )
        return explanation
      }
    }

    logEvent('tengu_permission_explainer_error', {
      tool_name: sanitizeToolNameForAnalytics(toolName),
      error_type: ERROR_TYPE_PARSE_FAILED,
      latency_ms: latencyMs,
    })
    logForDebugging('Permission explainer: no parsed output in response')
    return null
  } catch (error) {
    const latencyMs = Date.now() - start
    if (signal.aborted) {
      logForDebugging(`Permission explainer: request aborted for ${toolName}`)
      return null
    }
    logForDebugging(`Permission explainer error: ${errorMessage(error)}`)
    logEvent('tengu_permission_explainer_error', {
      tool_name: sanitizeToolNameForAnalytics(toolName),
      error_type:
        error instanceof Error && error.name === 'AbortError'
          ? ERROR_TYPE_ABORTED
          : ERROR_TYPE_API_ERROR,
      latency_ms: latencyMs,
    })
    return null
  }
}

// ant OPO — risk level → theme color key.
export function riskLevelColor(level: RiskLevel): 'success' | 'warning' | 'error' {
  switch (level) {
    case 'LOW':
      return 'success'
    case 'MEDIUM':
      return 'warning'
    case 'HIGH':
      return 'error'
  }
}

// ant TPO — risk level → short label.
export function riskLevelLabel(level: RiskLevel): string {
  switch (level) {
    case 'LOW':
      return 'Low risk'
    case 'MEDIUM':
      return 'Med risk'
    case 'HIGH':
      return 'High risk'
  }
}
