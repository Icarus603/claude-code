
import type { ProviderDep, ProviderStreamParams, ProviderEvent } from '@claude-code/agent'
import type { ToolUseContext, Tools } from '../Tool.js'
import type { Message } from '../types/message.js'

export class ProviderDepImpl implements ProviderDep {
  private toolUseContext: ToolUseContext
  private querySource?: string

  constructor(toolUseContext: ToolUseContext, querySource?: string) {
    this.toolUseContext = toolUseContext
    this.querySource = querySource
  }

  async *stream(params: ProviderStreamParams): AsyncGenerator<ProviderEvent> {
    const { queryModelWithStreaming } = await import('../services/api/claude.js')
    const ctx = this.toolUseContext

    const systemPrompt = ctx.renderedSystemPrompt ?? params.systemPrompt
    const tools = (ctx.options.tools ?? []) as unknown as Tools
    const appState = ctx.getAppState?.()

    const options: Record<string, unknown> = {
      ...ctx.options,
      model: params.model ?? ctx.options.mainLoopModel,
      querySource: this.querySource ?? (ctx.options as any).querySource ?? 'repl_main_thread',
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
          (c: any) => c.type === 'pending',
        )
      }
    }

    const stream = queryModelWithStreaming({
      messages: params.messages as Message[],
      systemPrompt: systemPrompt as any,
      thinkingConfig: ctx.options.thinkingConfig,
      tools,
      signal: params.abortSignal ?? ctx.abortController.signal,
      options: options as any,
    })

    for await (const event of stream) {
      yield event as unknown as ProviderEvent
    }
  }

  getModel(): string {
    return this.toolUseContext.options.mainLoopModel
  }
}
