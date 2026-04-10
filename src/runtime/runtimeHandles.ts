import type {
  AgentCatalogHandle,
  HostSessionStore,
  McpRuntimeHandle,
  McpRuntimeSnapshot,
  PermissionRuntimeHandle,
  PluginRuntimeHandle,
  PluginRuntimeSnapshot,
  RuntimeHandles,
} from '@claude-code/app-host'
import type { HeadlessStoreParams } from '@claude-code/cli'
import {
  applyPermissionUpdates,
  persistPermissionUpdates,
} from '@claude-code/permission/PermissionUpdate'
import type { PermissionUpdate } from '@claude-code/permission/PermissionUpdateSchema'
import type { ToolPermissionContext } from '../Tool.js'
import { getEmptyToolPermissionContext } from '../Tool.js'
import type { AppState } from '../state/AppStateCompat.js'
import { getDefaultAppState } from '../state/AppStateCompat.js'
import { createHeadlessSessionStore } from '../state/sessionStores.js'
import { createStore, type Store } from '../state/store.js'
import type { AgentDefinitionsResult } from '../tools/AgentTool/loadAgentsDir.js'
import type { LoadedPlugin, PluginError } from '../types/plugin.js'
import type { Command } from '../commands.js'
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
  ServerResource,
} from '../services/mcp/types.js'

type SnapshotStore<T> = Store<T>

function createSnapshotStore<T>(initialState: T): SnapshotStore<T> {
  return createStore(initialState)
}

type RuntimeHandleSet = RuntimeHandles & {
  permission: PermissionRuntimeHandle<ToolPermissionContext, PermissionUpdate>
  mcp: McpRuntimeHandle<
    MCPServerConnection,
    unknown,
    Command,
    ServerResource,
    ScopedMcpServerConfig
  >
  plugins: PluginRuntimeHandle<LoadedPlugin, Command, PluginError>
  agentCatalog: AgentCatalogHandle<AgentDefinitionsResult>
  sessionStoreFactory: {
    createHeadlessStore: (
      params?: HeadlessStoreParams,
    ) => HostSessionStore<AppState>
  }
}

export function createRuntimeHandles(
  initialState: AppState = (() => {
    try {
      return getDefaultAppState()
    } catch {
      return {
        toolPermissionContext: getEmptyToolPermissionContext(),
        mcp: {
          clients: [],
          tools: [],
          commands: [],
          resources: {},
          pluginReconnectKey: 0,
        },
        plugins: {
          enabled: [],
          disabled: [],
          commands: [],
          errors: [],
          installationStatus: {
            marketplaces: [],
            plugins: [],
          },
          needsRefresh: false,
        },
        agentDefinitions: { activeAgents: [], allAgents: [] },
      } as AppState
    }
  })(),
): RuntimeHandleSet {
  const permissionStore = createSnapshotStore(initialState.toolPermissionContext)
  const mcpStore = createSnapshotStore<McpRuntimeSnapshot<
    MCPServerConnection,
    unknown,
    Command,
    ServerResource
  >>({
    clients: initialState.mcp.clients,
    tools: initialState.mcp.tools,
    commands: initialState.mcp.commands,
    resources: initialState.mcp.resources,
  })
  const pluginStore = createSnapshotStore<
    PluginRuntimeSnapshot<LoadedPlugin, Command, PluginError>
  >({
    enabled: initialState.plugins.enabled,
    disabled: initialState.plugins.disabled,
    commands: initialState.plugins.commands,
    errors: initialState.plugins.errors,
    installationStatus: initialState.plugins.installationStatus,
    needsRefresh: initialState.plugins.needsRefresh,
  })
  const agentCatalogStore = createSnapshotStore(initialState.agentDefinitions)

  return {
    permission: {
      getContext: () => permissionStore.getState(),
      setContext: next => permissionStore.setState(() => next),
      buildUpdates: (...args: unknown[]) =>
        (Array.isArray(args[0]) ? args[0] : []) as PermissionUpdate[],
      applyUpdates: updates => {
        let nextContext = permissionStore.getState()
        nextContext = applyPermissionUpdates(nextContext as any, updates)
        permissionStore.setState(() => nextContext)
        return nextContext
      },
      persistUpdates: updates => {
        persistPermissionUpdates(updates as any)
      },
    },
    mcp: {
      getSnapshot: () => mcpStore.getState(),
      setSnapshot: snapshot => mcpStore.setState(() => snapshot),
      subscribe: listener => mcpStore.subscribe(listener),
      refresh: () => {},
      getResources: serverName =>
        mcpStore.getState().resources[serverName] ?? [],
    },
    plugins: {
      getSnapshot: () => pluginStore.getState(),
      setSnapshot: snapshot => pluginStore.setState(() => snapshot),
      subscribe: listener => pluginStore.subscribe(listener),
      refresh: () => {},
    },
    agentCatalog: {
      getDefinitions: () => agentCatalogStore.getState(),
      setDefinitions: next => agentCatalogStore.setState(() => next),
      refresh: () => {},
    },
    sessionStoreFactory: {
      createHeadlessStore: params =>
        createHeadlessSessionStore(
          (params ?? {
            mcpClients: [],
            mcpCommands: [],
            mcpTools: [],
            toolPermissionContext: permissionStore.getState(),
            effort: undefined,
            effectiveModel: null,
          }) as HeadlessStoreParams,
        ),
    },
  }
}

export function syncRuntimeHandlesFromAppState(
  handles: RuntimeHandles,
  state: AppState,
): void {
  handles.permission.setContext(state.toolPermissionContext)
  handles.mcp.setSnapshot?.({
    clients: state.mcp.clients,
    tools: state.mcp.tools,
    commands: state.mcp.commands,
    resources: state.mcp.resources,
  })
  handles.plugins.setSnapshot?.({
    enabled: state.plugins.enabled,
    disabled: state.plugins.disabled,
    commands: state.plugins.commands,
    errors: state.plugins.errors,
    installationStatus: state.plugins.installationStatus,
    needsRefresh: state.plugins.needsRefresh,
  })
  handles.agentCatalog.setDefinitions?.(state.agentDefinitions)
}

export function syncRuntimeHandlesFromHeadlessParams(
  handles: RuntimeHandles,
  params: HeadlessStoreParams,
): void {
  handles.permission.setContext(params.toolPermissionContext)
  handles.mcp.setSnapshot?.({
    clients: params.mcpClients,
    tools: params.mcpTools,
    commands: params.mcpCommands as Command[],
    resources: {},
  })
}
