import uniqBy from 'lodash-es/uniqBy.js'
import type {
  ToolCategory,
  ToolLike,
  ToolPermissionContextLike,
  ToolProvider,
  ToolRegistration,
  ToolRegistryEvents,
} from './contracts.js'
import { getToolRegistryHostBindings } from './host.js'

export class ToolRegistry<
  TTool extends ToolLike = ToolLike,
  TPermissionContext extends ToolPermissionContextLike = ToolPermissionContextLike,
> {
  private toolsByName = new Map<string, TTool>()
  private registrationsByName = new Map<string, ToolRegistration<TTool>>()
  private aliasIndex = new Map<string, string>()
  private providers = new Map<string, ToolProvider<TTool>>()
  private events: ToolRegistryEvents<TTool>

  constructor(events?: ToolRegistryEvents<TTool>) {
    this.events = events ?? {}
  }

  register(tool: TTool, category: ToolCategory, providerName: string): void {
    this.toolsByName.set(tool.name, tool)
    this.registrationsByName.set(tool.name, {
      tool,
      category,
      providerName,
    })

    if (tool.aliases) {
      for (const alias of tool.aliases) {
        this.aliasIndex.set(alias, tool.name)
      }
    }

    this.events.onRegister?.({ tool, category, providerName })
  }

  unregister(name: string): boolean {
    const tool = this.toolsByName.get(name)
    if (!tool) return false

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

  async registerProvider(provider: ToolProvider<TTool>): Promise<void> {
    this.providers.set(provider.name, provider)
    const tools = await provider.discover()
    for (const tool of tools) {
      this.register(tool, 'builtin', provider.name)
    }
  }

  get(name: string): TTool | undefined {
    const direct = this.toolsByName.get(name)
    if (direct) return direct

    const canonical = this.aliasIndex.get(name)
    if (canonical) return this.toolsByName.get(canonical)
    return undefined
  }

  getAll(): TTool[] {
    return Array.from(this.toolsByName.values())
  }

  getRegistrations(): ToolRegistration<TTool>[] {
    return Array.from(this.registrationsByName.values())
  }

  getByCategory(category: ToolCategory): TTool[] {
    return this.getRegistrations()
      .filter(r => r.category === category)
      .map(r => r.tool)
  }

  getRegistration(name: string): ToolRegistration<TTool> | undefined {
    return this.registrationsByName.get(name)
  }

  has(name: string): boolean {
    return this.toolsByName.has(name) || this.aliasIndex.has(name)
  }

  filterByDenyRules<T extends Pick<TTool, 'name' | 'mcpInfo'>>(
    tools: readonly T[],
    permissionContext: TPermissionContext,
  ): T[] {
    const bindings = getToolRegistryHostBindings()
    return tools.filter(
      tool =>
        !bindings.getDenyRuleForTool(
          permissionContext,
          tool as Pick<TTool, 'name' | 'mcpInfo'>,
        ),
    )
  }

  getEnabledTools(permissionContext: TPermissionContext): TTool[] {
    const all = this.getByCategory('builtin')
    const allowed = this.filterByDenyRules(all, permissionContext)
    return allowed.filter(tool => tool.isEnabled())
  }

  assemblePool(
    permissionContext: TPermissionContext,
    mcpTools: readonly TTool[],
  ): TTool[] {
    const builtInTools = this.getEnabledTools(permissionContext)
    const allowedMcpTools = this.filterByDenyRules(mcpTools, permissionContext)
    const byName = (a: TTool, b: TTool) => a.name.localeCompare(b.name)
    return uniqBy(
      [...builtInTools].sort(byName).concat([...allowedMcpTools].sort(byName)),
      'name',
    )
  }

  static findIn<T extends Pick<ToolLike, 'name' | 'aliases'>>(
    tools: readonly T[],
    name: string,
  ): T | undefined {
    return tools.find(
      t => t.name === name || (t.aliases?.includes(name) ?? false),
    )
  }

  clear(): void {
    this.toolsByName.clear()
    this.registrationsByName.clear()
    this.aliasIndex.clear()
    this.providers.clear()
  }

  get size(): number {
    return this.toolsByName.size
  }
}
