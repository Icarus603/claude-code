
import type { PermissionDep, CoreTool, PermissionResult, PermissionContext } from '@claude-code/agent'
import type { CanUseToolFn, ToolUseContext, Tool as RealTool, Tools } from '../Tool.js'
import { findToolByName } from '../Tool.js'

export class PermissionDepImpl implements PermissionDep {
  private canUseToolFn: CanUseToolFn
  private toolUseContext: ToolUseContext
  private tools: Tools

  constructor(canUseToolFn: CanUseToolFn, toolUseContext: ToolUseContext, tools: Tools) {
    this.canUseToolFn = canUseToolFn
    this.toolUseContext = toolUseContext
    this.tools = tools
  }

  async canUseTool(tool: CoreTool, input: unknown, context: PermissionContext): Promise<PermissionResult> {
    const realTool = findToolByName(this.tools, tool.name)
    if (!realTool) {
      return { allowed: false, reason: `Unknown tool: ${tool.name}` }
    }

    try {
      const decision = await this.canUseToolFn(
        realTool,
        input as Record<string, unknown>,
        this.toolUseContext,
        { type: 'assistant', uuid: crypto.randomUUID(), message: { role: 'assistant', content: [] } } as any,
        '',
      )

      if (decision.behavior === 'allow') {
        return { allowed: true }
      }
      return {
        allowed: false,
        reason: decision.behavior === 'deny' ? 'Permission denied' : 'User cancelled',
      }
    } catch (error) {
      return {
        allowed: false,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
