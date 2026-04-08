import type { Tool, Tools } from '../../../Tool.js'
import type { ToolProvider } from '../types.js'

/**
 * User tools provider — future extension point for user-defined tools
 * from ~/.claude/tools/.
 *
 * First version is a stub. The full implementation would:
 * - Scan ~/.claude/tools/ for tool scripts
 * - Parse tool definitions (name, schema, description)
 * - Execute tools in a sandboxed context
 */
export const UserToolsProvider: ToolProvider = {
  name: 'user',
  async discover(): Promise<Tools> {
    // Stub: no user tools yet
    return []
  },
}
