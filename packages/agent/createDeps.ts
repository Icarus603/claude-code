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
    // Per-model routing (V7 §11.6 Stage 2): pass model so connections[]
    // can route to the right protocol (codex / openai / gemini / anthropic).
    const adapter = getProviderAdapter(options.model as string)

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
  constructor(
    private readonly toolUseContext: RuntimeToolUseContext,
    private readonly querySource: string,
    private readonly contextOverrides: CreateDepsParams['contextOverrides'],
  ) {}

  async onTurnStart(): Promise<void> {}

  async onTurnEnd(): Promise<void> {}

  async onStop(
    messages: CoreMessage[],
    _context: StopHookContext,
  ): Promise<StopHookResult> {
    // handleStopHooks is an AsyncGenerator with a StopHookResult return value.
    // Iterating drives the body to completion; the return value lives on the
    // final iterator result (`done: true`). The previous `await handleStopHooks(...)`
    // bug never iterated, so the body never ran and `result?.blockingErrors`
    // was always undefined — plugin Stop hooks silently no-op'd in headless.
    try {
      const systemPrompt =
        (this.contextOverrides?.systemPrompt ?? []) as never[]
      const userContext = this.contextOverrides?.userContext ?? {}
      const systemContext = this.contextOverrides?.systemContext ?? {}

      // Split incoming messages into the (history, assistant-tail) shape
      // handleStopHooks expects. The tail is everything after the last
      // user/system message, i.e. assistant turns only — matching what
      // query.ts passes (`messagesForQuery`, `assistantMessages`).
      const lastNonAssistant = (messages as AgentMessage[]).findLastIndex(
        m => m.type !== 'assistant',
      )
      const messagesForQuery =
        lastNonAssistant >= 0
          ? (messages.slice(0, lastNonAssistant + 1) as AgentMessage[])
          : []
      const assistantMessages =
        lastNonAssistant >= 0
          ? (messages.slice(lastNonAssistant + 1) as AgentAssistantMessage[])
          : (messages as AgentAssistantMessage[])

      const generator = handleStopHooks(
        messagesForQuery,
        assistantMessages,
        systemPrompt,
        userContext as Record<string, string>,
        systemContext as Record<string, string>,
        this.toolUseContext,
        this.querySource as never,
      )

      // Drain the generator. Yielded items are progress messages destined
      // for the REPL transcript; in the headless path we just discard them
      // (the SDK driver doesn't have a transcript stream to surface them on).
      // The final return value carries the result — `for await` skips it,
      // so we step the iterator manually.
      let lastResult: StopHookResult = {
        blockingErrors: [],
        preventContinuation: false,
      }
      let next = await generator.next()
      while (!next.done) {
        next = await generator.next()
      }
      if (next.value) {
        lastResult = {
          blockingErrors:
            (next.value as { blockingErrors?: unknown[] })?.blockingErrors?.map(
              String,
            ) ?? [],
          preventContinuation:
            (next.value as { preventContinuation?: boolean })
              ?.preventContinuation ?? false,
        }
      }
      return lastResult
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
    hooks: new HookDepImpl(
      toolUseContext,
      querySource ?? 'sdk',
      contextOverrides,
    ),
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
