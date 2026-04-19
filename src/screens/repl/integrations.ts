import type { MCPServerConnection } from '@claude-code/mcp-runtime/types.js';

const EMPTY_MCP_CLIENTS: MCPServerConnection[] = [];

export function getInteractiveMcpClients(
  isRemoteSession: boolean,
  mcpClients: MCPServerConnection[] | undefined,
): MCPServerConnection[] {
  return isRemoteSession ? EMPTY_MCP_CLIENTS : (mcpClients ?? EMPTY_MCP_CLIENTS);
}
