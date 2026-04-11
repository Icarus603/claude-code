import {
  installMcpRuntimeHostBindings,
  type McpRuntimeHostBindings,
} from '@claude-code/mcp-runtime'
import {
  handleMcpSetServers,
  reconcileMcpServers,
} from '../../cli/mcpServersHandlers.js'
import * as clientRuntime from './clientRuntime.js'

let installed = false

type AnyBindings = McpRuntimeHostBindings<
  unknown,
  unknown,
  unknown,
  unknown,
  unknown
>

export function installMcpRuntimeBindings(): void {
  if (installed) {
    return
  }

  const bindings: AnyBindings = {
    connectAll: clientRuntime.connectAll,
    discover: clientRuntime.discover,
    executeTool: clientRuntime.executeTool,
    getMcpToolsCommandsAndResources:
      clientRuntime.getMcpToolsCommandsAndResources,
    prefetchResources: clientRuntime.prefetchResources,
    prefetchAllMcpResources: clientRuntime.prefetchAllMcpResources,
    handleMcpSetServers:
      handleMcpSetServers as AnyBindings['handleMcpSetServers'],
    reconcileMcpServers:
      reconcileMcpServers as AnyBindings['reconcileMcpServers'],
    legacy: clientRuntime as unknown as Record<string, unknown>,
  }

  installMcpRuntimeHostBindings(bindings)
  installed = true
}

installMcpRuntimeBindings()
