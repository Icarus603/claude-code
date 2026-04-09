// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { feature } from 'bun:bundle'
import {
  TOOL_PRESETS as PACKAGE_TOOL_PRESETS,
  assembleToolPool as assembleToolPoolFromPackage,
  filterToolsByDenyRules as filterToolsByDenyRulesFromPackage,
  getAllBaseTools as getAllBaseToolsFromPackage,
  getMergedTools as getMergedToolsFromPackage,
  getToolRegistry as getToolRegistryFromPackage,
  getTools as getToolsFromPackage,
  getToolsForDefaultPreset as getToolsForDefaultPresetFromPackage,
  installToolRegistryHostBindings,
  parseToolPreset as parseToolPresetFromPackage,
} from '@claude-code/tool-registry'
import { toolMatchesName, type Tool, type ToolPermissionContext, type Tools } from './Tool.js'
import {
  ALL_AGENT_DISALLOWED_TOOLS,
  CUSTOM_AGENT_DISALLOWED_TOOLS,
  ASYNC_AGENT_ALLOWED_TOOLS,
  COORDINATOR_MODE_ALLOWED_TOOLS,
} from './constants/tools.js'
import { AgentTool } from './tools/AgentTool/AgentTool.js'
import { BashTool } from './tools/BashTool/BashTool.js'
import { FileEditTool } from './tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from './tools/FileReadTool/FileReadTool.js'
import {
  REPL_TOOL_NAME,
  REPL_ONLY_TOOLS,
  isReplModeEnabled,
} from './tools/REPLTool/constants.js'
import { BuiltInToolsProvider } from './tools/registry/providers/BuiltInToolsProvider.js'
import { ReadMcpResourceTool } from './tools/ReadMcpResourceTool/ReadMcpResourceTool.js'
import { SendMessageTool } from './tools/SendMessageTool/SendMessageTool.js'
import { SYNTHETIC_OUTPUT_TOOL_NAME } from './tools/SyntheticOutputTool/SyntheticOutputTool.js'
import { TaskStopTool } from './tools/TaskStopTool/TaskStopTool.js'
import { ListMcpResourcesTool } from './tools/ListMcpResourcesTool/ListMcpResourcesTool.js'
import { isEnvTruthy } from './utils/envUtils.js'
import { getDenyRuleForTool } from '@claude-code/permission/permissions'

/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
const REPLTool =
  process.env.USER_TYPE === 'ant'
    ? require('./tools/REPLTool/REPLTool.js').REPLTool
    : null
const coordinatorModeModule = feature('COORDINATOR_MODE')
  ? (require('./coordinator/coordinatorMode.js') as typeof import('./coordinator/coordinatorMode.js'))
  : null
/* eslint-enable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */

let registryHostBindingsInstalled = false

function ensureToolRegistryBindingsInstalled(): void {
  if (registryHostBindingsInstalled) return

  installToolRegistryHostBindings({
    discoverBuiltInTools: () => BuiltInToolsProvider.discover() as Tool[],
    getDenyRuleForTool: (permissionContext, tool) =>
      getDenyRuleForTool(permissionContext as ToolPermissionContext, tool as any),
    getModeAwareTools: ({
      permissionContext,
      baseTools,
      filterToolsByDenyRules,
    }) => {
      const permissionCtx = permissionContext as ToolPermissionContext
      const allTools = baseTools as Tool[]
      const filterByDeny = (tools: readonly Tool[]): Tool[] =>
        filterToolsByDenyRules(tools as Tool[], permissionCtx) as Tool[]

      if (isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) {
        if (isReplModeEnabled() && REPLTool) {
          const replSimple: Tool[] = [REPLTool]
          if (
            feature('COORDINATOR_MODE') &&
            coordinatorModeModule?.isCoordinatorMode()
          ) {
            replSimple.push(TaskStopTool, SendMessageTool)
          }
          return filterByDeny(replSimple)
        }

        const simpleTools: Tool[] = [BashTool, FileReadTool, FileEditTool]
        if (
          feature('COORDINATOR_MODE') &&
          coordinatorModeModule?.isCoordinatorMode()
        ) {
          simpleTools.push(AgentTool, TaskStopTool, SendMessageTool)
        }
        return filterByDeny(simpleTools)
      }

      const specialTools = new Set([
        ListMcpResourcesTool.name,
        ReadMcpResourceTool.name,
        SYNTHETIC_OUTPUT_TOOL_NAME,
      ])
      const filtered = allTools.filter(tool => !specialTools.has(tool.name))
      let allowedTools = filterByDeny(filtered)

      if (isReplModeEnabled()) {
        const replEnabled = allowedTools.some(tool =>
          toolMatchesName(tool, REPL_TOOL_NAME),
        )
        if (replEnabled) {
          allowedTools = allowedTools.filter(
            tool => !REPL_ONLY_TOOLS.has(tool.name),
          )
        }
      }

      return allowedTools.filter(tool => tool.isEnabled())
    },
  })

  registryHostBindingsInstalled = true
}

// Install host bindings on module load so any direct
// @claude-code/tool-registry caller can rely on an initialized runtime.
ensureToolRegistryBindingsInstalled()

export {
  ALL_AGENT_DISALLOWED_TOOLS,
  CUSTOM_AGENT_DISALLOWED_TOOLS,
  ASYNC_AGENT_ALLOWED_TOOLS,
  COORDINATOR_MODE_ALLOWED_TOOLS,
  REPL_ONLY_TOOLS,
}

export const TOOL_PRESETS = PACKAGE_TOOL_PRESETS
export type ToolPreset = (typeof TOOL_PRESETS)[number]

export function parseToolPreset(preset: string): ToolPreset | null {
  ensureToolRegistryBindingsInstalled()
  return parseToolPresetFromPackage(preset) as ToolPreset | null
}

export function getToolsForDefaultPreset(): string[] {
  ensureToolRegistryBindingsInstalled()
  return getToolsForDefaultPresetFromPackage()
}

export function getToolRegistry() {
  ensureToolRegistryBindingsInstalled()
  return getToolRegistryFromPackage()
}

export function getAllBaseTools(): Tools {
  ensureToolRegistryBindingsInstalled()
  return getAllBaseToolsFromPackage() as unknown as Tools
}

export function filterToolsByDenyRules<
  T extends {
    name: string
    mcpInfo?: { serverName: string; toolName: string }
  },
>(tools: readonly T[], permissionContext: ToolPermissionContext): T[] {
  ensureToolRegistryBindingsInstalled()
  return filterToolsByDenyRulesFromPackage(
    tools,
    permissionContext as any,
  ) as T[]
}

export function getTools(permissionContext: ToolPermissionContext): Tools {
  ensureToolRegistryBindingsInstalled()
  return getToolsFromPackage(permissionContext as any) as unknown as Tools
}

export function assembleToolPool(
  permissionContext: ToolPermissionContext,
  mcpTools: Tools,
): Tools {
  ensureToolRegistryBindingsInstalled()
  return assembleToolPoolFromPackage(
    permissionContext as any,
    mcpTools as any,
  ) as unknown as Tools
}

export function getMergedTools(
  permissionContext: ToolPermissionContext,
  mcpTools: Tools,
): Tools {
  ensureToolRegistryBindingsInstalled()
  return getMergedToolsFromPackage(
    permissionContext as any,
    mcpTools as any,
  ) as unknown as Tools
}
