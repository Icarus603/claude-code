import type { Tool, Tools } from '../../Tool.js'

/**
 * Tool category — identifies where a tool came from.
 */
export type ToolCategory = 'builtin' | 'mcp' | 'plugin' | 'user'

/**
 * Metadata stored alongside each registered tool.
 */
export type ToolRegistration = {
  tool: Tool
  category: ToolCategory
  /** Name of the provider that registered this tool. */
  providerName: string
}

/**
 * A ToolProvider discovers and returns a set of tools.
 * Implementations represent different discovery mechanisms (builtin, MCP, plugin, user).
 */
export type ToolProvider = {
  /** Unique name for this provider (used in metadata / debugging). */
  name: string
  /** Discover and return the tools this provider knows about. */
  discover(): Promise<Tools> | Tools
}

/**
 * Callback signatures for registry events.
 */
export type ToolRegistryEvents = {
  onRegister?: (registration: ToolRegistration) => void
  onUnregister?: (name: string) => void
}
