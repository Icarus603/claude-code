import type { RuntimeGraph } from '@claude-code/app-host'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { Command } from '../../commands.js'
import { useMergedClients } from '../../hooks/useMergedClients.js'
import { useMergedCommands } from '../../hooks/useMergedCommands.js'
import { useMergedTools } from '../../hooks/useMergedTools.js'
import type {
  MCPServerConnection,
  ServerResource,
} from '../../services/mcp/types.js'
import type { Tool, ToolPermissionContext } from '../../Tool.js'
import type {
  AgentDefinition,
  AgentDefinitionsResult,
} from '../../tools/AgentTool/loadAgentsDir.js'
import type { LoadedPlugin, PluginError } from '../../types/plugin.js'
import { getTools } from '../../tools.js'
import { resolveAgentTools } from '../../tools/AgentTool/agentToolUtils.js'
import { getInteractiveMcpClients } from './integrations.js'

type McpSnapshot = {
  clients: MCPServerConnection[]
  tools: Tool[]
  commands: Command[]
  resources: Record<string, ServerResource[]>
}

type PluginSnapshot = {
  enabled: LoadedPlugin[]
  disabled: LoadedPlugin[]
  commands: Command[]
  errors: PluginError[]
  installationStatus: {
    marketplaces: Array<{
      name: string
      status: 'pending' | 'installing' | 'installed' | 'failed'
      error?: string
    }>
    plugins: Array<{
      id: string
      name: string
      status: 'pending' | 'installing' | 'installed' | 'failed'
      error?: string
    }>
  }
  needsRefresh: boolean
}

type Args = {
  runtimeGraph?: RuntimeGraph
  initialMcpClients?: MCPServerConnection[]
  initialTools: Tool[]
  localCommands: Command[]
  isRemoteSession: boolean
  disableSlashCommands: boolean
  mainThreadAgentDefinition?: AgentDefinition
  proactiveActive: boolean
  isBriefOnly: boolean
  toolPermissionContext: ToolPermissionContext
  mcp: McpSnapshot
  plugins: PluginSnapshot
  agentDefinitions: AgentDefinitionsResult
}

function useRuntimeMcpSnapshot(
  runtimeGraph: RuntimeGraph | undefined,
  fallback: McpSnapshot,
): McpSnapshot {
  const handle = runtimeGraph?.handles.mcp
  return handle
    ? useSyncExternalStore(
        handle.subscribe,
        () => handle.getSnapshot() as McpSnapshot,
        () => handle.getSnapshot() as McpSnapshot,
      )
    : fallback
}

function useRuntimePluginSnapshot(
  runtimeGraph: RuntimeGraph | undefined,
  fallback: PluginSnapshot,
): PluginSnapshot {
  const handle = runtimeGraph?.handles.plugins
  return handle
    ? useSyncExternalStore(
        handle.subscribe,
        () => handle.getSnapshot() as PluginSnapshot,
        () => handle.getSnapshot() as PluginSnapshot,
      )
    : fallback
}

export function useReplRuntimeViews({
  runtimeGraph,
  initialMcpClients,
  initialTools,
  localCommands,
  isRemoteSession,
  disableSlashCommands,
  mainThreadAgentDefinition,
  proactiveActive,
  isBriefOnly,
  toolPermissionContext,
  mcp,
  plugins,
  agentDefinitions,
}: Args) {
  useEffect(() => {
    if (!runtimeGraph) return

    runtimeGraph.handles.permission.setContext(toolPermissionContext)
    runtimeGraph.handles.mcp.setSnapshot?.(mcp)
    runtimeGraph.handles.plugins.setSnapshot?.(plugins)
    runtimeGraph.handles.agentCatalog.setDefinitions?.(agentDefinitions)
  }, [runtimeGraph, toolPermissionContext, mcp, plugins, agentDefinitions])

  const runtimeMcp = useRuntimeMcpSnapshot(runtimeGraph, mcp)
  const runtimePlugins = useRuntimePluginSnapshot(runtimeGraph, plugins)
  const runtimeAgentDefinitions =
    (runtimeGraph?.handles.agentCatalog.getDefinitions() as
      | AgentDefinitionsResult
      | undefined) ?? agentDefinitions

  const localTools = useMemo(
    () => getTools(toolPermissionContext),
    [toolPermissionContext, proactiveActive, isBriefOnly],
  )

  const mcpClients = useMergedClients(initialMcpClients, runtimeMcp.clients)
  const interactiveMcpClients = getInteractiveMcpClients(
    isRemoteSession,
    mcpClients,
  )

  const combinedInitialTools = useMemo(
    () => [...localTools, ...initialTools],
    [localTools, initialTools],
  )
  const mergedTools = useMergedTools(
    combinedInitialTools,
    runtimeMcp.tools,
    toolPermissionContext,
  )

  const { tools, allowedAgentTypes } = useMemo(() => {
    if (!mainThreadAgentDefinition) {
      return {
        tools: mergedTools,
        allowedAgentTypes: undefined as string[] | undefined,
      }
    }

    const resolved = resolveAgentTools(
      mainThreadAgentDefinition,
      mergedTools,
      false,
      true,
    )
    return {
      tools: resolved.resolvedTools,
      allowedAgentTypes: resolved.allowedAgentTypes,
    }
  }, [mainThreadAgentDefinition, mergedTools])

  const commandsWithPlugins = useMergedCommands(
    localCommands,
    runtimePlugins.commands,
  )
  const mergedCommands = useMergedCommands(
    commandsWithPlugins,
    runtimeMcp.commands,
  )
  const commands = useMemo(
    () => (disableSlashCommands ? [] : mergedCommands),
    [disableSlashCommands, mergedCommands],
  )

  return {
    agentDefinitions: runtimeAgentDefinitions,
    allowedAgentTypes,
    combinedInitialTools,
    commands,
    interactiveMcpClients,
    mcp: runtimeMcp,
    mcpClients,
    plugins: runtimePlugins,
    tools,
  }
}
