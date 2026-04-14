import type { McpRuntimeHostBindings } from './contracts.js'
import { HostBindingsError } from './errors.js'

type AnyMcpRuntimeHostBindings = McpRuntimeHostBindings<
  unknown,
  unknown,
  unknown,
  unknown,
  unknown
>

let mcpRuntimeHostBindings: AnyMcpRuntimeHostBindings | null = null

export function installMcpRuntimeHostBindings<
  TMcpTool,
  TMcpCommand,
  TMcpResource,
  TMcpConfig,
  TMcpConnection,
>(
  bindings: McpRuntimeHostBindings<
    TMcpTool,
    TMcpCommand,
    TMcpResource,
    TMcpConfig,
    TMcpConnection
  >,
): void {
  mcpRuntimeHostBindings = bindings as unknown as AnyMcpRuntimeHostBindings
}

export function getMcpRuntimeHostBindings<
  TMcpTool,
  TMcpCommand,
  TMcpResource,
  TMcpConfig,
  TMcpConnection,
>(): McpRuntimeHostBindings<
  TMcpTool,
  TMcpCommand,
  TMcpResource,
  TMcpConfig,
  TMcpConnection
> {
  if (!mcpRuntimeHostBindings) {
    throw new HostBindingsError(
      'MCP runtime host bindings have not been installed. Install host bindings before using @claude-code/mcp-runtime runtime APIs.',
    )
  }
  return mcpRuntimeHostBindings as McpRuntimeHostBindings<
    TMcpTool,
    TMcpCommand,
    TMcpResource,
    TMcpConfig,
    TMcpConnection
  >
}
