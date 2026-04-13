import { getProviderAdapter, getProviderContextPipeline } from '@claude-code/provider'
import '@claude-code/provider/providerHostSetup'
import { findToolByName } from '@claude-code/tool-registry'
import { handleStopHooks } from './hooks/index.js'
import type {
  AgentAssistantMessage,
  AgentMessage,
  AgentToolUseContext,
} from './internalTypes.js'
import { getAgentHostBindings } from './host.js'
import { recordTranscript } from './internal/runtimeBridges.js'
import type { AgentDeps, CoreMessage, ProviderEvent, ProviderStreamParams, StopHookContext, StopHookResult, SystemPrompt } from './index.js'

type RuntimeTool = {
  name: string
  aliases?: string[]
  inputJSONSchema?: unknown
  inputSchema?: { parse: (input: unknown) => unknown }
  isMcp?: boolean
  userFacingName: (input?: unknown) => string
  call: (
    input: unknown,
    context: RuntimeToolUseContext,
    canUseTool: (...args: unknown[]) => Promise<unknown>,
    parentMessage: AgentAssistantMessage,
    onProgress?: (progress: unknown) => void,
  ) => Promise<unknown>
  checkPermissions: (
    input: unknown,
    context: RuntimeToolUseContext,
  ) => Promise<{ behavior: string; updatedInput?: unknown }>
  requiresUserInteraction?: () => boolean
}

type RuntimeToolUseContext = AgentToolUseContext & {
  renderedSystemPrompt?: unknown
  messages?: AgentMessage[]
  localDenialTracking?: unknown
  options: AgentToolUseContext['options'] & {
    tools: RuntimeTool[]
    thinkingConfig?: unknown
    querySource?: string
    agentDefinitions?: {
      activeAgents: unknown[]
      allowedAgentTypes: unknown[]
    }
  }
}

type CanUseToolFn = (
  tool: RuntimeTool,
  input: Record<string, unknown>,
  context: RuntimeToolUseContext,
  assistantMessage: AgentAssistantMessage,
  toolUseId: string,
) => Promise<{ behavior: 'allow' | 'deny' | 'ask'; updatedInput?: unknown }>

export interface CreateDepsParams {
  tools: RuntimeTool[]
  toolUseContext: RuntimeToolUseContext
  canUseTool: CanUseToolFn
  emitFn?: (event: unknown) => void
  querySource?: string
  contextOverrides?: {
    systemPrompt?: SystemPrompt[]
    userContext?: Record<string, string>
    systemContext?: Record<string, string>
  }
}

class ProviderDepImpl implements AgentDeps['provider'] {
  constructor(
    private readonly toolUseContext: RuntimeToolUseContext,
    private readonly querySource?: string,
  ) {}

  async *stream(params: ProviderStreamParams): AsyncGenerator<ProviderEvent> {
    const ctx = this.toolUseContext
    const adapter = getProviderAdapter()
    const systemPrompt = ctx.renderedSystemPrompt ?? params.systemPrompt
    const appState = ctx.getAppState?.()
    const options: Record<string, unknown> = {
      ...ctx.options,
      model: params.model ?? ctx.options.mainLoopModel,
      querySource:
        this.querySource ??
        (ctx.options.querySource as string | undefined) ??
        'repl_main_thread',
    }

    if (!options.getToolPermissionContext && appState) {
      options.getToolPermissionContext = async () => appState.toolPermissionContext
    }
    if (!options.agents && ctx.options.agentDefinitions) {
      options.agents = ctx.options.agentDefinitions.activeAgents
    }
    if (!options.allowedAgentTypes && ctx.options.agentDefinitions) {
      options.allowedAgentTypes = ctx.options.agentDefinitions.allowedAgentTypes
    }
    if (appState) {
      if (!options.mcpTools) options.mcpTools = appState.mcp?.tools
      if (!options.hasPendingMcpServers) {
        options.hasPendingMcpServers = appState.mcp?.clients?.some(
          (client: { type?: string }) => client.type === 'pending',
        )
      }
    }

    const stream = adapter.queryStream({
      messages: params.messages as AgentMessage[],
      systemPrompt: systemPrompt as never,
      thinkingConfig: ctx.options.thinkingConfig as never,
      tools: ctx.options.tools as never,
      signal: (params.abortSignal ?? ctx.abortController.signal) as AbortSignal,
      options: options as never,
    })

    for await (const event of stream) {
      yield event as ProviderEvent
    }
  }

  getModel(): string {
    return this.toolUseContext.options.mainLoopModel
  }
}

class ToolDepImpl implements AgentDeps['tools'] {
  constructor(
    private readonly tools: RuntimeTool[],
    private readonly toolUseContext: RuntimeToolUseContext,
  ) {}

  find(name: string) {
    const tool = findToolByName(this.tools, name)
    return tool ? this.toCoreTool(tool) : undefined
  }

  list() {
    return this.tools.map(tool => this.toCoreTool(tool))
  }

  async execute(tool: AgentDeps['tools'] extends { execute: infer _ } ? any : never, input: unknown, context: { toolUseId: string }) {
    const realTool = findToolByName(this.tools, tool.name)
    if (!realTool) {
      return { output: `Tool not found: ${tool.name}`, error: true }
    }

    try {
      const result = await realTool.call(
        input,
        {
          ...this.toolUseContext,
          toolUseId: context.toolUseId,
        },
        async () => ({ decision: 'allow' as const }),
        {
          type: 'assistant',
          uuid: crypto.randomUUID(),
          message: { role: 'assistant', content: [] },
        } as AgentAssistantMessage,
        () => {},
      )

      if (typeof result === 'string') {
        return { output: result }
      }

      return {
        output:
          typeof result === 'object' && result !== null
            ? JSON.stringify(result)
            : String(result),
      }
    } catch (error) {
      return {
        output: error instanceof Error ? error.message : String(error),
        error: true,
      }
    }
  }

  private toCoreTool(tool: RuntimeTool) {
    return {
      name: tool.name,
      description: '',
      inputSchema: (tool.inputJSONSchema ?? { type: 'object' }) as Record<
        string,
        unknown
      >,
      userFacingName: tool.userFacingName(undefined),
      isLocal: !tool.isMcp,
      isMcp: !!tool.isMcp,
    }
  }
}

class PermissionDepImpl implements AgentDeps['permission'] {
  constructor(
    private readonly canUseToolFn: CanUseToolFn,
    private readonly toolUseContext: RuntimeToolUseContext,
    private readonly tools: RuntimeTool[],
  ) {}

  async canUseTool(tool: { name: string }, input: unknown): Promise<{
    allowed: boolean
    reason?: string
  }> {
    const realTool = findToolByName(this.tools, tool.name)
    if (!realTool) {
      return { allowed: false, reason: `Unknown tool: ${tool.name}` }
    }

    try {
      const decision = await this.canUseToolFn(
        realTool,
        (input ?? {}) as Record<string, unknown>,
        this.toolUseContext,
        {
          type: 'assistant',
          uuid: crypto.randomUUID(),
          message: { role: 'assistant', content: [] },
        } as AgentAssistantMessage,
        '',
      )

      if (decision.behavior === 'allow') {
        return { allowed: true }
      }
      return {
        allowed: false,
        reason:
          decision.behavior === 'deny' ? 'Permission denied' : 'User cancelled',
      }
    } catch (error) {
      return {
        allowed: false,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

class OutputDepImpl implements AgentDeps['output'] {
  constructor(private readonly emitFn?: (event: unknown) => void) {}

  emit(event: unknown): void {
    this.emitFn?.(event)
  }
}

class HookDepImpl implements AgentDeps['hooks'] {
  constructor(private readonly toolUseContext: RuntimeToolUseContext) {}

  async onTurnStart(): Promise<void> {}

  async onTurnEnd(): Promise<void> {}

  async onStop(
    messages: CoreMessage[],
    context: StopHookContext,
  ): Promise<StopHookResult> {
    try {
      const result = await handleStopHooks(
        messages as AgentMessage[],
        this.toolUseContext,
      )
      return {
        blockingErrors: result?.blockingErrors ?? [],
        preventContinuation: result?.preventContinuation ?? false,
      }
    } catch {
      return { blockingErrors: [], preventContinuation: false }
    }
  }
}

class ContextDepImpl implements AgentDeps['context'] {
  private readonly contextPipeline = getProviderContextPipeline()

  constructor(
    private readonly toolUseContext: RuntimeToolUseContext,
    private readonly overrides?: CreateDepsParams['contextOverrides'],
  ) {}

  getSystemPrompt(): SystemPrompt[] {
    if (this.overrides?.systemPrompt) {
      return this.overrides.systemPrompt
    }
    if (this.toolUseContext.renderedSystemPrompt) {
      return [this.toolUseContext.renderedSystemPrompt as SystemPrompt]
    }
    return []
  }

  async getUserContext(): Promise<Record<string, string>> {
    if (this.overrides?.userContext) {
      return this.overrides.userContext
    }
    try {
      return await this.contextPipeline.getUserContext()
    } catch {
      return {}
    }
  }

  async getSystemContext(): Promise<Record<string, string>> {
    if (this.overrides?.systemContext) {
      return this.overrides.systemContext
    }
    try {
      return await this.contextPipeline.getSystemContext()
    } catch {
      return {}
    }
  }
}

class SessionDepImpl implements AgentDeps['session'] {
  getSessionId(): string {
    return getAgentHostBindings().getSessionId?.() ?? 'unknown'
  }

  async recordTranscript(messages: CoreMessage[]): Promise<void> {
    try {
      await recordTranscript(messages as AgentMessage[])
    } catch {}
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
    output: new OutputDepImpl(emitFn),
    hooks: new HookDepImpl(toolUseContext),
    compaction: {
      maybeCompact: async messages => ({
        compacted: false,
        messages,
      }),
    },
    context: new ContextDepImpl(toolUseContext, contextOverrides),
    session: new SessionDepImpl(),
  }
}

export function toCoreMessages(messages: AgentMessage[]): CoreMessage[] {
  return messages as CoreMessage[]
}

export function fromCoreMessages(messages: CoreMessage[]): AgentMessage[] {
  return messages as AgentMessage[]
}

export function fromAgentEvent(event: { type: string; [key: string]: unknown }) {
  switch (event.type) {
    case 'message': {
      const msg = event.message
      if (!msg) return undefined
      if (typeof msg === 'object' && msg !== null && 'message' in msg) {
        return msg
      }
      return undefined
    }
    case 'stream':
      return event.event
    case 'request_start':
      return { type: 'stream_request_start' as const }
    case 'done':
      return undefined
    default:
      return undefined
  }
}
