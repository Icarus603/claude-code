import type { Tool, Tools } from '../../../Tool.js'
import type { ToolProvider } from '../types.js'

/**
 * Plugin tools provider — future extension point for npm-package-based tools.
 *
 * First version is a stub. The full implementation would:
 * - Read .claude/plugins.json or similar config
 * - Load npm packages that export Tool definitions
 * - Run tools in a sandboxed context
 */
export const PluginToolsProvider: ToolProvider = {
  name: 'plugin',
  async discover(): Promise<Tools> {
    // Stub: no plugin tools yet
    return []
  },
}
