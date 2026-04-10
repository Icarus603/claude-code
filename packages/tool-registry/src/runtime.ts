import { ensureToolRegistryRuntimeInstalled } from './toolRuntimeInstaller.js'
import {
  TOOL_PRESETS as PACKAGE_TOOL_PRESETS,
  assembleToolPool as assembleToolPoolFromPackage,
  filterToolsByDenyRules as filterToolsByDenyRulesFromPackage,
  getAllBaseTools as getAllBaseToolsFromPackage,
  getMergedTools as getMergedToolsFromPackage,
  getToolRegistry as getToolRegistryFromPackage,
  getTools as getToolsFromPackage,
  getToolsForDefaultPreset as getToolsForDefaultPresetFromPackage,
  parseToolPreset as parseToolPresetFromPackage,
} from './api.js'
import type {
  ToolLike,
  ToolPermissionContextLike,
} from './contracts.js'
import { getToolRegistryHostBindings } from './host.js'
import {
  ALL_AGENT_DISALLOWED_TOOLS,
  CUSTOM_AGENT_DISALLOWED_TOOLS,
  ASYNC_AGENT_ALLOWED_TOOLS,
  COORDINATOR_MODE_ALLOWED_TOOLS,
} from './constants.js'

export type Tool = ToolLike
export type ToolPermissionContext = ToolPermissionContextLike
export type Tools = readonly Tool[]

const REPL_ONLY_TOOLS_TARGET = new Set<string>()
let replOnlyToolsInitialized = false

function ensureReplOnlyToolsInitialized(): void {
  if (replOnlyToolsInitialized) return
  ensureToolRegistryRuntimeInstalled()
  REPL_ONLY_TOOLS_TARGET.clear()
  for (const name of getToolRegistryHostBindings().replOnlyToolNames()) {
    REPL_ONLY_TOOLS_TARGET.add(name)
  }
  replOnlyToolsInitialized = true
}

export const REPL_ONLY_TOOLS = new Proxy(REPL_ONLY_TOOLS_TARGET, {
  get(target, prop, receiver) {
    ensureReplOnlyToolsInitialized()
    const value = Reflect.get(target, prop, receiver)
    return typeof value === 'function' ? value.bind(target) : value
  },
}) as Set<string>

export {
  ALL_AGENT_DISALLOWED_TOOLS,
  CUSTOM_AGENT_DISALLOWED_TOOLS,
  ASYNC_AGENT_ALLOWED_TOOLS,
  COORDINATOR_MODE_ALLOWED_TOOLS,
}

export const TOOL_PRESETS = PACKAGE_TOOL_PRESETS
export type ToolPreset = (typeof TOOL_PRESETS)[number]

export function installToolRegistryRuntimeBindings(): void {
  ensureToolRegistryRuntimeInstalled()
}

export function parseToolPreset(preset: string): ToolPreset | null {
  return parseToolPresetFromPackage(preset) as ToolPreset | null
}

export function getToolsForDefaultPreset(): string[] {
  ensureToolRegistryRuntimeInstalled()
  return getToolsForDefaultPresetFromPackage()
}

export function getToolRegistry() {
  ensureToolRegistryRuntimeInstalled()
  return getToolRegistryFromPackage()
}

export function getAllBaseTools(): Tools {
  ensureToolRegistryRuntimeInstalled()
  return getAllBaseToolsFromPackage() as unknown as Tools
}

export function filterToolsByDenyRules<
  T extends {
    name: string
    mcpInfo?: { serverName: string; toolName: string }
  },
>(tools: readonly T[], permissionContext: ToolPermissionContext): T[] {
  ensureToolRegistryRuntimeInstalled()
  return filterToolsByDenyRulesFromPackage(
    tools,
    permissionContext as any,
  ) as T[]
}

export function getTools(permissionContext: ToolPermissionContext): Tools {
  ensureToolRegistryRuntimeInstalled()
  return getToolsFromPackage(permissionContext as any) as unknown as Tools
}

export function assembleToolPool(
  permissionContext: ToolPermissionContext,
  mcpTools: Tools,
): Tools {
  ensureToolRegistryRuntimeInstalled()
  return assembleToolPoolFromPackage(
    permissionContext as any,
    mcpTools as any,
  ) as unknown as Tools
}

export function getMergedTools(
  permissionContext: ToolPermissionContext,
  mcpTools: Tools,
): Tools {
  ensureToolRegistryRuntimeInstalled()
  return getMergedToolsFromPackage(
    permissionContext as any,
    mcpTools as any,
  ) as unknown as Tools
}
