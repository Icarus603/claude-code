import type { Tool, Tools } from '../../../Tool.js'
import type { ToolProvider } from '../types.js'

/**
 * MCP tools provider — wraps the dynamic MCP tool creation that already
 * exists in services/mcp/client.ts.
 *
 * This provider doesn't do the discovery itself; instead it receives the
 * already-discovered MCP tools via setTools() at runtime (when MCP servers
 * connect/disconnect). The provider pattern gives us a uniform interface
 * while keeping the actual MCP connection lifecycle in services/mcp/.
 */
export class McpToolsProvider implements ToolProvider {
  readonly name = 'mcp'
  private currentTools: Tools = []

  /** Update the MCP tool list (called when servers connect/disconnect). */
  setTools(tools: Tools): void {
    this.currentTools = tools
  }

  discover(): Tools {
    return this.currentTools
  }
}
