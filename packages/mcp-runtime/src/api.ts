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

export async function connectAll<TMcpConfig, TMcpConnection>(
  configs: Record<string, TMcpConfig>,
): Promise<TMcpConnection[]> {
  const host = getMcpRuntimeHostBindings<
    unknown,
    unknown,
    unknown,
    TMcpConfig,
    TMcpConnection
  >()

  if (host.connectAll) {
    return host.connectAll(configs)
  }

  const clients: TMcpConnection[] = []
  await host.getMcpToolsCommandsAndResources(({ client }) => {
    clients.push(client)
  }, configs)
  return clients
}

export async function discover<
  TMcpTool,
  TMcpCommand,
  TMcpResource,
  TMcpConfig,
  TMcpConnection,
>(
  configs?: Record<string, TMcpConfig>,
): Promise<{
  clients: TMcpConnection[]
  tools: TMcpTool[]
  commands: TMcpCommand[]
  resources?: Record<string, TMcpResource[]>
}> {
  const host = getMcpRuntimeHostBindings<
    TMcpTool,
    TMcpCommand,
    TMcpResource,
    TMcpConfig,
    TMcpConnection
  >()

  if (host.discover) {
    return host.discover(configs)
  }

  const clients: TMcpConnection[] = []
  const tools: TMcpTool[] = []
  const commands: TMcpCommand[] = []
  const resources: Record<string, TMcpResource[]> = {}

  await host.getMcpToolsCommandsAndResources(result => {
    clients.push(result.client)
    tools.push(...result.tools)
    commands.push(...result.commands)
    if (result.resources) {
      resources[(result.client as any)?.name ?? `server-${clients.length}`] =
        result.resources
    }
  }, configs)

  return {
    clients,
    tools,
    commands,
    ...(Object.keys(resources).length > 0 ? { resources } : {}),
  }
}

export async function executeTool<TMcpConfig>(
  call: {
    serverName: string
    serverConfig: TMcpConfig
    toolName: string
    input: Record<string, unknown>
    meta?: Record<string, unknown>
    signal?: AbortSignal
  },
): Promise<unknown> {
  const host = getMcpRuntimeHostBindings<
    unknown,
    unknown,
    unknown,
    TMcpConfig,
    unknown
  >()
  if (!host.executeTool) {
    throw new Error('MCP runtime host binding does not implement executeTool')
  }
  return host.executeTool(call)
}

export async function prefetchResources<
  TMcpTool,
  TMcpCommand,
  TMcpResource,
  TMcpConfig,
  TMcpConnection,
>(
  configs: Record<string, TMcpConfig>,
): Promise<{
  clients: TMcpConnection[]
  tools: TMcpTool[]
  commands: TMcpCommand[]
  resources?: Record<string, TMcpResource[]>
}> {
  const host = getMcpRuntimeHostBindings<
    TMcpTool,
    TMcpCommand,
    TMcpResource,
    TMcpConfig,
    TMcpConnection
  >()

  if (host.prefetchResources) {
    return host.prefetchResources(configs)
  }

  return discover(configs)
}
