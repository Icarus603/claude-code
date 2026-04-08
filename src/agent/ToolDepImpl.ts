
import type { ToolDep, CoreTool, ToolResult, ToolExecContext } from '@claude-code/agent'
import type { Tool, ToolUseContext, Tools } from '../Tool.js'
import { findToolByName } from '../Tool.js'

export class ToolDepImpl implements ToolDep {
  private tools: Tools
  private toolUseContext: ToolUseContext

  constructor(tools: Tools, toolUseContext: ToolUseContext) {
    this.tools = tools
    this.toolUseContext = toolUseContext
  }

  find(name: string): CoreTool | undefined {
    const tool = findToolByName(this.tools, name)
    if (!tool) return undefined
    return this.toCoreTool(tool)
  }

  list(): CoreTool[] {
    return this.tools.map(tool => this.toCoreTool(tool))
  }

  async execute(tool: CoreTool, input: unknown, context: ToolExecContext): Promise<ToolResult> {
    const realTool = findToolByName(this.tools, tool.name)
    if (!realTool) {
      return { output: `Tool not found: ${tool.name}`, error: true }
    }

    try {
      const result = await realTool.call(
        input as any,
        {
          ...this.toolUseContext,
          toolUseId: context.toolUseId,
        },
        async () => ({ decision: 'allow' as const }),
        { type: 'assistant', uuid: crypto.randomUUID(), message: { role: 'assistant', content: [] } } as any,
        (_progress: unknown) => {},
      )

      if (typeof result === 'string') {
        return { output: result }
      }
      return {
        output: typeof result === 'object' && result !== null
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

  private toCoreTool(tool: Tool): CoreTool {
    return {
      name: tool.name,
      description: '',
      inputSchema: (tool.inputJSONSchema ?? { type: 'object' }) as any,
      userFacingName: tool.userFacingName(undefined),
      isLocal: !tool.isMcp,
      isMcp: !!tool.isMcp,
    }
  }
}
