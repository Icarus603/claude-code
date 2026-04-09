import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { randomUUID } from 'crypto'
import type {
  ProviderAssistantMessage,
  ProviderMessage,
  ProviderSystemAPIErrorMessage,
  ProviderTool,
  ProviderToolPermissionContext,
  ProviderTools,
  ProviderToolSchemaOptions,
} from './contracts.js'

export const TOOL_SEARCH_TOOL_NAME = 'ToolSearch'

export function safeParseJSON(input: string): unknown {
  try {
    return JSON.parse(input)
  } catch {
    return null
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function createAssistantAPIErrorMessage(args: {
  content: string
  apiError?: unknown
  error?: unknown
  errorDetails?: string
}): ProviderAssistantMessage | ProviderSystemAPIErrorMessage {
  const message = {
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: args.content || 'No content',
      },
    ],
  }

  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    isApiErrorMessage: true,
    apiError: args.apiError,
    error: args.error,
    errorDetails: args.errorDetails,
    message,
  } as ProviderAssistantMessage
}

export function normalizeContentFromAPI(
  blocks: unknown,
  _tools: ProviderTools,
  _agentId?: string,
): ProviderMessage['message']['content'] {
  if (!Array.isArray(blocks)) return []
  return blocks.map(block => {
    if (!block || typeof block !== 'object') return block
    const typed = block as Record<string, unknown>
    if (typed.type === 'tool_use' && typeof typed.input === 'string') {
      return {
        ...typed,
        input: safeParseJSON(typed.input) ?? {},
      }
    }
    if (typed.type === 'server_tool_use' && typeof typed.input === 'string') {
      return {
        ...typed,
        input: safeParseJSON(typed.input) ?? {},
      }
    }
    return typed
  }) as ProviderMessage['message']['content']
}

export function normalizeMessagesForAPI(
  messages: readonly ProviderMessage[],
  _tools: ProviderTools,
): ProviderMessage[] {
  return messages.filter(
    msg =>
      (msg.type === 'user' || msg.type === 'assistant') &&
      !msg.isVirtual &&
      msg.message &&
      msg.message.content !== undefined,
  )
}

function getToolDescription(
  tool: ProviderTool,
  options: ProviderToolSchemaOptions,
): Promise<string> | string {
  if (typeof tool.prompt === 'function') {
    return tool.prompt({
      getToolPermissionContext:
        options.getToolPermissionContext ??
        (async () =>
          ({
            mode: 'default',
          }) as ProviderToolPermissionContext),
      tools: options.tools,
      agents: options.agents,
      allowedAgentTypes: options.allowedAgentTypes,
    })
  }
  if (typeof tool.description === 'function') {
    return tool.description()
  }
  if (typeof tool.description === 'string') {
    return tool.description
  }
  return ''
}

function getToolInputSchema(tool: ProviderTool): Record<string, unknown> {
  const candidate =
    'inputJSONSchema' in tool
      ? (tool.inputJSONSchema as unknown)
      : undefined
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    return candidate as Record<string, unknown>
  }

  return {
    type: 'object',
    properties: {},
  }
}

export async function toolToAPISchema(
  tool: ProviderTool,
  options: ProviderToolSchemaOptions,
): Promise<BetaToolUnion> {
  const schema: Record<string, unknown> = {
    name: tool.name,
    description: await getToolDescription(tool, options),
    input_schema: getToolInputSchema(tool),
  }

  if (options.deferLoading) {
    schema.defer_loading = true
  }
  if (options.cacheControl) {
    schema.cache_control = options.cacheControl
  }

  return schema as BetaToolUnion
}

export function calculateUSDCost(_model: string, _usage: unknown): number {
  return 0
}

export function isDeferredTool(tool: ProviderTool): boolean {
  return tool.isMcp === true || tool.shouldDefer === true
}

export function extractDiscoveredToolNames(
  messages: readonly ProviderMessage[],
): Set<string> {
  const discovered = new Set<string>()
  for (const message of messages) {
    if (message.type !== 'user') continue
    const content = message.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        'type' in block &&
        (block as { type: unknown }).type === 'tool_result' &&
        'content' in block &&
        Array.isArray((block as { content: unknown }).content)
      ) {
        for (const item of (block as { content: unknown[] }).content) {
          if (
            item &&
            typeof item === 'object' &&
            'type' in item &&
            (item as { type: unknown }).type === 'tool_reference' &&
            'tool_name' in item &&
            typeof (item as { tool_name: unknown }).tool_name === 'string'
          ) {
            discovered.add((item as { tool_name: string }).tool_name)
          }
        }
      }
    }
  }
  return discovered
}

export async function isToolSearchEnabled(
  _model: string,
  tools: ProviderTools,
  _getToolPermissionContext: () => Promise<ProviderToolPermissionContext>,
  _agents: readonly { [key: string]: unknown }[],
  _querySource?: string,
): Promise<boolean> {
  return (
    process.env.ENABLE_TOOL_SEARCH !== 'false' &&
    tools.some(tool => tool.name === TOOL_SEARCH_TOOL_NAME)
  )
}
