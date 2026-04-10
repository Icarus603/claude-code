export type RuntimeBindingInstallers = {
  installCorePackageBindings?: () => void
  installProviderBindings?: () => void
  installToolRegistryBindings?: () => void
  installCommandRuntimeBindings?: () => void
  installMcpRuntimeBindings?: () => void
  installCliBindings?: () => void
}

export type HostSessionStore<TState = unknown> = {
  getState: () => TState
  setState: (updater: (prev: TState) => TState) => void
  subscribe: (listener: () => void) => () => void
}

export type PermissionRuntimeHandle<TContext = unknown, TUpdate = unknown> = {
  getContext: () => TContext
  setContext: (next: TContext) => void
  buildUpdates: (...args: unknown[]) => TUpdate[]
  applyUpdates: (updates: TUpdate[]) => TContext
  persistUpdates: (updates: TUpdate[]) => void
}

export type McpRuntimeSnapshot<
  TMcpClient = unknown,
  TMcpTool = unknown,
  TMcpCommand = unknown,
  TMcpResource = unknown,
> = {
  clients: TMcpClient[]
  tools: TMcpTool[]
  commands: TMcpCommand[]
  resources: Record<string, TMcpResource[]>
}

export type McpRuntimeHandle<
  TMcpClient = unknown,
  TMcpTool = unknown,
  TMcpCommand = unknown,
  TMcpResource = unknown,
  TMcpConfig = unknown,
> = {
  getSnapshot: () => McpRuntimeSnapshot<
    TMcpClient,
    TMcpTool,
    TMcpCommand,
    TMcpResource
  >
  setSnapshot?: (
    snapshot: McpRuntimeSnapshot<
      TMcpClient,
      TMcpTool,
      TMcpCommand,
      TMcpResource
    >,
  ) => void
  subscribe: (listener: () => void) => () => void
  refresh: (configs?: Record<string, TMcpConfig>) => Promise<void> | void
  getResources: (serverName: string) => TMcpResource[]
}

export type PluginRuntimeSnapshot<
  TPlugin = unknown,
  TPluginCommand = unknown,
  TPluginError = unknown,
> = {
  enabled: TPlugin[]
  disabled: TPlugin[]
  commands: TPluginCommand[]
  errors: TPluginError[]
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

export type PluginRuntimeHandle<
  TPlugin = unknown,
  TPluginCommand = unknown,
  TPluginError = unknown,
> = {
  getSnapshot: () => PluginRuntimeSnapshot<TPlugin, TPluginCommand, TPluginError>
  setSnapshot?: (
    snapshot: PluginRuntimeSnapshot<TPlugin, TPluginCommand, TPluginError>,
  ) => void
  subscribe: (listener: () => void) => () => void
  refresh: () => Promise<void> | void
}

export type AgentCatalogHandle<TAgentDefinitions = unknown> = {
  getDefinitions: () => TAgentDefinitions
  setDefinitions?: (next: TAgentDefinitions) => void
  refresh: () => Promise<void> | void
}

export type SessionStoreFactory = {
  createInteractiveStore?: (initialState?: unknown) => HostSessionStore
  createHeadlessStore?: (params?: unknown) => HostSessionStore
}

export type RuntimeHandles = {
  permission: PermissionRuntimeHandle
  mcp: McpRuntimeHandle
  plugins: PluginRuntimeHandle
  agentCatalog: AgentCatalogHandle
  sessionStoreFactory: SessionStoreFactory
}

export type RuntimeGraph = {
  createdAt: number
  handles: RuntimeHandles
}

export type HostFactoryOptions = {
  runtimeGraph: RuntimeGraph
}

export type HostFactory<T = unknown> = (
  options: HostFactoryOptions,
) => T
