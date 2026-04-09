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
}
