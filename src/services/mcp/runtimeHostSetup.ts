import {
  installMcpRuntimeHostBindings,
  type McpRuntimeHostBindings,
} from '@claude-code/mcp-runtime'
import * as clientRuntime from './clientRuntime.js'

let installed = false

export function installMcpRuntimeBindings(): void {
  if (installed) {
    return
  }

  const bindings: McpRuntimeHostBindings<unknown, unknown, unknown, unknown, unknown> = {
    connectAll: clientRuntime.connectAll,
    discover: clientRuntime.discover,
    executeTool: clientRuntime.executeTool,
    getMcpToolsCommandsAndResources:
      clientRuntime.getMcpToolsCommandsAndResources,
    prefetchResources: clientRuntime.prefetchResources,
    prefetchAllMcpResources: clientRuntime.prefetchAllMcpResources,
    legacy: clientRuntime as unknown as Record<string, unknown>,
  }

  installMcpRuntimeHostBindings(bindings)
  installed = true
}

installMcpRuntimeBindings()
