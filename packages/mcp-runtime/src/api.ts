import { getMcpRuntimeHostBindings } from './host.js'

export async function getMcpToolsCommandsAndResources<
  TMcpTool,
  TMcpCommand,
  TMcpResource,
  TMcpConfig,
  TMcpConnection,
>(
  onConnectionAttempt: (params: {
    client: TMcpConnection
    tools: TMcpTool[]
    commands: TMcpCommand[]
    resources?: TMcpResource[]
  }) => void,
  sdkMcpConfigs?: Record<string, TMcpConfig>,
): Promise<void> {
  return getMcpRuntimeHostBindings<
    TMcpTool,
    TMcpCommand,
    TMcpResource,
    TMcpConfig,
    TMcpConnection
  >().getMcpToolsCommandsAndResources(onConnectionAttempt, sdkMcpConfigs)
}

export async function prefetchAllMcpResources<
  TMcpTool,
  TMcpCommand,
  TMcpConfig,
  TMcpConnection,
>(
  mcpConfigs: Record<string, TMcpConfig>,
): Promise<{
  clients: TMcpConnection[]
  tools: TMcpTool[]
  commands: TMcpCommand[]
}> {
  return getMcpRuntimeHostBindings<
    unknown,
    TMcpTool,
    TMcpCommand,
    unknown,
    TMcpConfig,
    TMcpConnection
  >().prefetchAllMcpResources(mcpConfigs)
}
