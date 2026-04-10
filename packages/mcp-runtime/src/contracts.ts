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
  legacy?: Record<string, unknown>
}
