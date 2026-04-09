
import type { AgentDeps, CoreMessage } from '@claude-code/agent'
import type { ToolUseContext, Tools } from '../Tool.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import type { Message } from '../types/message.js'
import { ProviderDepImpl } from './ProviderDepImpl.js'
import { ToolDepImpl } from './ToolDepImpl.js'
import { PermissionDepImpl } from './PermissionDepImpl.js'
import { OutputDepImpl } from './OutputDepImpl.js'
import { HookDepImpl } from './HookDepImpl.js'
import { CompactionDepImpl } from './CompactionDepImpl.js'
import { ContextDepImpl } from './ContextDepImpl.js'
import { SessionDepImpl } from './SessionDepImpl.js'
import type { SystemPrompt } from '@claude-code/agent'

export interface CreateDepsParams {
  tools: Tools
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  emitFn?: (event: unknown) => void
  querySource?: string
  contextOverrides?: {
    systemPrompt?: SystemPrompt[]
    userContext?: Record<string, string>
    systemContext?: Record<string, string>
  }
}

export function createProductionDeps(params: CreateDepsParams): AgentDeps {
  const {
    tools,
    toolUseContext,
    canUseTool,
    emitFn,
    querySource,
    contextOverrides,
  } = params

  return {
    provider: new ProviderDepImpl(toolUseContext, querySource),
    tools: new ToolDepImpl(tools, toolUseContext),
    permission: new PermissionDepImpl(canUseTool, toolUseContext, tools),
    output: new OutputDepImpl(toolUseContext, emitFn),
    hooks: new HookDepImpl(toolUseContext),
    compaction: new CompactionDepImpl(toolUseContext),
    context: new ContextDepImpl(
      toolUseContext,
      contextOverrides,
    ) as unknown as AgentDeps['context'],
    session: new SessionDepImpl(),
  }
}

/**
 */
export function toCoreMessages(messages: Message[]): CoreMessage[] {
  return messages as unknown as CoreMessage[]
}

/**
 */
export function fromCoreMessages(messages: CoreMessage[]): Message[] {
  return messages as unknown as Message[]
}

/**
 *
 * - AgentEvent.message (assistant) → { type: 'assistant', message: { role, content, ... }, uuid, timestamp }
 * - AgentEvent.message (user) → { type: 'user', message: { role, content, ... }, uuid, timestamp }
 */
export function fromAgentEvent(event: any): any {
  switch (event.type) {
    case 'message': {
      const msg = event.message
      if (!msg) return undefined
      if (msg.message && typeof msg.message === 'object' && 'content' in msg.message) {
        return msg
      }
      if (msg.type === 'assistant') {
        return {
          type: 'assistant' as const,
          message: {
            role: 'assistant',
            content: msg.content,
            stop_reason: (msg as any).stop_reason ?? null,
            usage: (msg as any).usage ?? { input_tokens: 0, output_tokens: 0 },
            model: (msg as any).model,
            id: (msg as any).id,
          },
          uuid: (msg as any).uuid,
          timestamp: (msg as any).timestamp,
        }
      }
      if (msg.type === 'user') {
        return {
          type: 'user' as const,
          message: {
            role: 'user',
            content: msg.content,
          },
          uuid: (msg as any).uuid,
          timestamp: (msg as any).timestamp,
          toolUseResult: (msg as any).toolUseResult,
        }
      }
      if (msg.type === 'system') {
        return {
          type: 'system' as const,
          message: {
            role: 'system',
            content: (msg as any).content,
          },
          uuid: (msg as any).uuid,
          timestamp: (msg as any).timestamp,
          subtype: (msg as any).subtype,
        }
      }
      return undefined
    }
    case 'stream':
      return event.event as any
    case 'request_start':
      return { type: 'stream_request_start' as const }
    case 'done':
      return undefined
    default:
      return undefined
  }
}
