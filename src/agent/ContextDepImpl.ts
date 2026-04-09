
import type { SystemPrompt } from '@claude-code/agent'
import { getProviderContextPipeline } from '@claude-code/provider'
import '../services/api/providerHostSetup.js'
import type { ToolUseContext } from '../Tool.js'

type ContextOverrides = {
  systemPrompt?: SystemPrompt[]
  userContext?: Record<string, string>
  systemContext?: Record<string, string>
}

export class ContextDepImpl {
  private toolUseContext: ToolUseContext
  private overrides?: ContextOverrides
  private readonly contextPipeline = getProviderContextPipeline()

  constructor(toolUseContext: ToolUseContext, overrides?: ContextOverrides) {
    this.toolUseContext = toolUseContext
    this.overrides = overrides
  }

  getSystemPrompt(): SystemPrompt[] {
    if (this.overrides?.systemPrompt) {
      return this.overrides.systemPrompt
    }
    if (this.toolUseContext.renderedSystemPrompt) {
      return [this.toolUseContext.renderedSystemPrompt as unknown as SystemPrompt]
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
