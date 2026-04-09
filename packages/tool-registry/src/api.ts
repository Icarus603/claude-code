import uniqBy from 'lodash-es/uniqBy.js'
import { ToolRegistry } from './ToolRegistry.js'
import type { ToolLike, ToolPermissionContextLike } from './contracts.js'
import { getToolRegistryHostBindings } from './host.js'
import { BuiltInToolsProvider } from './providers/BuiltInToolsProvider.js'

let registrySingleton: ToolRegistry<ToolLike, ToolPermissionContextLike> | null =
  null

function ensureRegistry(): ToolRegistry<ToolLike, ToolPermissionContextLike> {
  if (registrySingleton) return registrySingleton

  const registry = new ToolRegistry<ToolLike, ToolPermissionContextLike>()
  const builtInTools = BuiltInToolsProvider.discover()
  for (const tool of builtInTools) {
    registry.register(tool, 'builtin', BuiltInToolsProvider.name)
  }
  registrySingleton = registry
  return registry
}

export function getToolRegistry(): ToolRegistry<
  ToolLike,
  ToolPermissionContextLike
> {
  return ensureRegistry()
}

export const TOOL_PRESETS = ['default'] as const
export type ToolPreset = (typeof TOOL_PRESETS)[number]

export function parseToolPreset(preset: string): ToolPreset | null {
  const normalized = preset.toLowerCase()
  if (!TOOL_PRESETS.includes(normalized as ToolPreset)) {
    return null
  }
  return normalized as ToolPreset
}

export function getToolsForDefaultPreset(): string[] {
  return getAllBaseTools()
    .filter(tool => tool.isEnabled())
    .map(tool => tool.name)
}

export function getAllBaseTools(): ToolLike[] {
  return getToolRegistry().getByCategory('builtin')
}

export function filterToolsByDenyRules<
  T extends { name: string; mcpInfo?: { serverName: string; toolName: string } },
>(tools: readonly T[], permissionContext: ToolPermissionContextLike): T[] {
  return getToolRegistry().filterByDenyRules(tools, permissionContext as any)
}

export function getTools(permissionContext: ToolPermissionContextLike): ToolLike[] {
  const hostBindings = getToolRegistryHostBindings()
  if (hostBindings.getModeAwareTools) {
    return hostBindings.getModeAwareTools({
      permissionContext,
      baseTools: getAllBaseTools(),
      filterToolsByDenyRules: (tools, context) =>
        filterToolsByDenyRules(tools, context),
    })
  }
  return getToolRegistry().getEnabledTools(permissionContext)
}

export function assembleToolPool(
  permissionContext: ToolPermissionContextLike,
  mcpTools: readonly ToolLike[],
): ToolLike[] {
  const builtInTools = getTools(permissionContext)
  const allowedMcpTools = filterToolsByDenyRules(mcpTools, permissionContext)
  const byName = (a: ToolLike, b: ToolLike) => a.name.localeCompare(b.name)
  return uniqBy(
    [...builtInTools].sort(byName).concat([...allowedMcpTools].sort(byName)),
    'name',
  )
}

export function getMergedTools(
  permissionContext: ToolPermissionContextLike,
  mcpTools: readonly ToolLike[],
): ToolLike[] {
  return [...getTools(permissionContext), ...mcpTools]
}

export function __resetToolRegistryForTests(): void {
  registrySingleton = null
}
