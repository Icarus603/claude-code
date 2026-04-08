import {
  toolMatchesName,
  type Tool,
  type ToolPermissionContext,
  type Tools,
} from '../../Tool.js'
import { getDenyRuleForTool } from '../../utils/permissions/permissions.js'
import uniqBy from 'lodash-es/uniqBy.js'
import type {
  ToolCategory,
  ToolProvider,
  ToolRegistration,
  ToolRegistryEvents,
} from './types.js'

/**
 * Central tool registry — the single source of truth for all available tools.
 *
 * Tools are registered by {@link ToolProvider}s (builtin, MCP, plugin, user).
 * The registry supports:
 * - O(1) lookup by name (including aliases)
 * - Dynamic register / unregister
 * - Assembly of the full tool pool (built-in + MCP, sorted for prompt-cache stability)
 * - Filtering by permission context, deny rules, isEnabled, REPL mode
 */
export class ToolRegistry {
  private toolsByName = new Map<string, Tool>()
  private registrationsByName = new Map<string, ToolRegistration>()
  private aliasIndex = new Map<string, string>() // alias → canonical name
  private providers = new Map<string, ToolProvider>()
  private events: ToolRegistryEvents

  constructor(events?: ToolRegistryEvents) {
    this.events = events ?? {}
  }

  // ── Registration ──────────────────────────────────────────────────

  /**
   * Register a single tool. Overwrites any existing tool with the same name.
   */
  register(tool: Tool, category: ToolCategory, providerName: string): void {
    this.toolsByName.set(tool.name, tool)
    this.registrationsByName.set(tool.name, {
      tool,
      category,
      providerName,
    })

    // Build alias index
    if (tool.aliases) {
      for (const alias of tool.aliases) {
        this.aliasIndex.set(alias, tool.name)
      }
    }

    this.events.onRegister?.({ tool, category, providerName })
  }

  /**
   * Unregister a tool by name. Also removes its aliases.
   */
  unregister(name: string): boolean {
    const tool = this.toolsByName.get(name)
    if (!tool) return false

    // Clean alias index
    if (tool.aliases) {
      for (const alias of tool.aliases) {
        const mapped = this.aliasIndex.get(alias)
        if (mapped === name) {
          this.aliasIndex.delete(alias)
        }
      }
    }

    this.toolsByName.delete(name)
    this.registrationsByName.delete(name)
    this.events.onUnregister?.(name)
    return true
  }

  /**
   * Register all tools discovered by a provider.
   */
  async registerProvider(provider: ToolProvider): Promise<void> {
    this.providers.set(provider.name, provider)
    const tools = await provider.discover()
    for (const tool of tools) {
      this.register(tool, 'builtin', provider.name)
    }
  }

  // ── Lookup ────────────────────────────────────────────────────────

  /**
   * Look up a tool by name or alias. Returns undefined if not found.
   */
  get(name: string): Tool | undefined {
    const direct = this.toolsByName.get(name)
    if (direct) return direct

    // Check alias index
    const canonical = this.aliasIndex.get(name)
    if (canonical) return this.toolsByName.get(canonical)

    return undefined
  }

  /**
   * Get all registered tools (no filtering).
   */
  getAll(): Tools {
    return Array.from(this.toolsByName.values())
  }

  /**
   * Get all registrations (tool + metadata).
   */
  getRegistrations(): ToolRegistration[] {
    return Array.from(this.registrationsByName.values())
  }

  /**
   * Get tools by category.
   */
  getByCategory(category: ToolCategory): Tools {
    return this.getRegistrations()
      .filter(r => r.category === category)
      .map(r => r.tool)
  }

  /**
   * Get the registration metadata for a tool name.
   */
  getRegistration(name: string): ToolRegistration | undefined {
    return this.registrationsByName.get(name)
  }

  /**
   * Check if a tool (or alias) is registered.
   */
  has(name: string): boolean {
    return this.toolsByName.has(name) || this.aliasIndex.has(name)
  }

  // ── Filtered access ──────────────────────────────────────────────

  /**
   * Filter tools that are blanket-denied by the permission context.
   * Same logic as the existing `filterToolsByDenyRules` in tools.ts.
   */
  filterByDenyRules<T extends { name: string; mcpInfo?: { serverName: string; toolName: string } }>(
    tools: readonly T[],
    permissionContext: ToolPermissionContext,
  ): T[] {
    return tools.filter(tool => !getDenyRuleForTool(permissionContext, tool))
  }

  /**
   * Get enabled built-in tools, filtered by permission context and isEnabled().
   * Equivalent to the existing `getTools()`.
   */
  getEnabledTools(permissionContext: ToolPermissionContext): Tools {
    const all = this.getByCategory('builtin')
    const allowed = this.filterByDenyRules(all, permissionContext)
    return allowed.filter(tool => tool.isEnabled())
  }

  /**
   * Assemble the full tool pool: built-in + MCP tools, sorted for prompt-cache
   * stability. Equivalent to the existing `assembleToolPool()`.
   *
   * Built-in tools form a contiguous prefix (sorted by name), followed by
   * MCP tools (also sorted). `uniqBy('name')` ensures built-ins win on
   * name conflicts.
   */
  assemblePool(
    permissionContext: ToolPermissionContext,
    mcpTools: Tools,
  ): Tools {
    const builtInTools = this.getEnabledTools(permissionContext)
    const allowedMcpTools = this.filterByDenyRules(mcpTools, permissionContext)

    const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name)
    return uniqBy(
      [...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)),
      'name',
    )
  }

  // ── Utility ──────────────────────────────────────────────────────

  /**
   * Find a tool by name or alias from a given list (static helper, no state needed).
   */
  static findIn(tools: Tools, name: string): Tool | undefined {
    return tools.find(
      t => t.name === name || (t.aliases?.includes(name) ?? false),
    )
  }

  /**
   * Clear all registrations. Useful for testing.
   */
  clear(): void {
    this.toolsByName.clear()
    this.registrationsByName.clear()
    this.aliasIndex.clear()
    this.providers.clear()
  }

  /**
   * Number of registered tools.
   */
  get size(): number {
    return this.toolsByName.size
  }
}
