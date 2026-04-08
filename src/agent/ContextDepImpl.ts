
import type { ContextDep, SystemPrompt } from '@claude-code/agent'
import type { ToolUseContext } from '../Tool.js'
import { getSystemContext, getUserContext } from '../context.js'

type ContextOverrides = {
  systemPrompt?: SystemPrompt[]
  userContext?: Record<string, string>
  systemContext?: Record<string, string>
}

export class ContextDepImpl implements ContextDep {
  private toolUseContext: ToolUseContext
  private overrides?: ContextOverrides

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
      return await getUserContext()
    } catch {
      return {}
    }
  }

  async getSystemContext(): Promise<Record<string, string>> {
    if (this.overrides?.systemContext) {
      return this.overrides.systemContext
    }
    try {
      return await getSystemContext()
    } catch {
      return {}
    }
  }
}
