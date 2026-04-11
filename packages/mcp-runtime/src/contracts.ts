/**
 * Dynamic (non-SDK) MCP connection state. Maintained by the SDK host
 * and passed to handleMcpSetServers / reconcileMcpServers. Runtime
 * types for clients/tools/configs are generic — the package doesn't
 * need to know the concrete shapes from root.
 */
export type DynamicMcpState<TConnection = unknown, TTools = unknown, TScopedConfig = unknown> = {
  clients: TConnection[]
  tools: TTools
  configs: Record<string, TScopedConfig>
}

/**
 * State for SDK MCP servers that run in the SDK process. Parallel to
 * DynamicMcpState but uses SDK-shaped configs.
 */
export type SdkMcpState<TConnection = unknown, TTools = unknown, TSdkConfig = unknown> = {
  configs: Record<string, TSdkConfig>
  clients: TConnection[]
  tools: TTools
}

/**
 * Result of handleMcpSetServers — new state on both sides + a response
 * envelope to deliver back to the SDK client.
 */
export type McpSetServersResult<
  TResponse = unknown,
  TConnection = unknown,
  TTools = unknown,
  TScopedConfig = unknown,
  TSdkConfig = unknown,
> = {
  response: TResponse
  newSdkState: SdkMcpState<TConnection, TTools, TSdkConfig>
  newDynamicState: DynamicMcpState<TConnection, TTools, TScopedConfig>
  sdkServersChanged: boolean
}

export type McpRuntimeHostBindings<
  TMcpTool,
  TMcpCommand,
  TMcpResource,
  TMcpConfig,
  TMcpConnection,
> = {
  getMcpToolsCommandsAndResources: (
    onConnectionAttempt: (params: {
      client: TMcpConnection
      tools: TMcpTool[]
      commands: TMcpCommand[]
      resources?: TMcpResource[]
    }) => void,
    sdkMcpConfigs?: Record<string, TMcpConfig>,
  ) => Promise<void>
  prefetchAllMcpResources: (mcpConfigs: Record<string, TMcpConfig>) => Promise<{
    clients: TMcpConnection[]
    tools: TMcpTool[]
    commands: TMcpCommand[]
  }>
  connectAll?: (
    configs: Record<string, TMcpConfig>,
  ) => Promise<TMcpConnection[]>
  discover?: (
    configs?: Record<string, TMcpConfig>,
  ) => Promise<{
    clients: TMcpConnection[]
    tools: TMcpTool[]
    commands: TMcpCommand[]
    resources?: Record<string, TMcpResource[]>
  }>
  executeTool?: (call: {
    serverName: string
    serverConfig: TMcpConfig
    toolName: string
    input: Record<string, unknown>
    meta?: Record<string, unknown>
    signal?: AbortSignal
  }) => Promise<unknown>
  prefetchResources?: (
    configs: Record<string, TMcpConfig>,
  ) => Promise<{
    clients: TMcpConnection[]
    tools: TMcpTool[]
    commands: TMcpCommand[]
    resources?: Record<string, TMcpResource[]>
  }>
  /**
   * SDK-side handler for mcp_set_servers control requests. Installed
   * from root (src/cli/mcpServersHandlers.ts) via runtimeHostSetup.
   * Types are opaque at the package boundary — callers cast the
   * result to their local specialization.
   */
  handleMcpSetServers?: (
    servers: Record<string, unknown>,
    sdkState: unknown,
    dynamicState: unknown,
    setAppState: (f: (prev: unknown) => unknown) => void,
  ) => Promise<unknown>
  reconcileMcpServers?: (
    desiredConfigs: Record<string, unknown>,
    currentState: unknown,
    setAppState: (f: (prev: unknown) => unknown) => void,
  ) => Promise<unknown>
  legacy?: Record<string, unknown>
}
