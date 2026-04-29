import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type {
  Resource,
  ServerCapabilities,
} from '@modelcontextprotocol/sdk/types.js'

// MCP server *config-shape* schemas + types live in @claude-code/config
// (one layer down). Hosting them here forced a config → mcp-runtime cycle
// for callers like config/plugin/_deps.ts. After the move, they're
// re-exported from this file so existing callers (which import from
// @claude-code/mcp-runtime/types) keep working without churn.
import {
  ConfigScopeSchema,
  type ConfigScope,
  TransportSchema,
  type Transport,
  McpStdioServerConfigSchema,
  McpSSEServerConfigSchema,
  McpSSEIDEServerConfigSchema,
  McpWebSocketIDEServerConfigSchema,
  McpHTTPServerConfigSchema,
  McpWebSocketServerConfigSchema,
  McpSdkServerConfigSchema,
  McpClaudeAIProxyServerConfigSchema,
  McpServerConfigSchema,
  type McpStdioServerConfig,
  type McpSSEServerConfig,
  type McpSSEIDEServerConfig,
  type McpWebSocketIDEServerConfig,
  type McpHTTPServerConfig,
  type McpWebSocketServerConfig,
  type McpSdkServerConfig,
  type McpClaudeAIProxyServerConfig,
  type McpServerConfig,
  type ScopedMcpServerConfig,
  McpJsonConfigSchema,
  type McpJsonConfig,
} from '@claude-code/config/mcpConfigSchema.js'

export {
  ConfigScopeSchema,
  type ConfigScope,
  TransportSchema,
  type Transport,
  McpStdioServerConfigSchema,
  McpSSEServerConfigSchema,
  McpSSEIDEServerConfigSchema,
  McpWebSocketIDEServerConfigSchema,
  McpHTTPServerConfigSchema,
  McpWebSocketServerConfigSchema,
  McpSdkServerConfigSchema,
  McpClaudeAIProxyServerConfigSchema,
  McpServerConfigSchema,
  type McpStdioServerConfig,
  type McpSSEServerConfig,
  type McpSSEIDEServerConfig,
  type McpWebSocketIDEServerConfig,
  type McpHTTPServerConfig,
  type McpWebSocketServerConfig,
  type McpSdkServerConfig,
  type McpClaudeAIProxyServerConfig,
  type McpServerConfig,
  type ScopedMcpServerConfig,
  McpJsonConfigSchema,
  type McpJsonConfig,
}

// Server connection types
export type ConnectedMCPServer = {
  client: Client
  name: string
  type: 'connected'
  capabilities: ServerCapabilities
  serverInfo?: {
    name: string
    version: string
  }
  instructions?: string
  config: ScopedMcpServerConfig
  cleanup: () => Promise<void>
}

export type FailedMCPServer = {
  name: string
  type: 'failed'
  config: ScopedMcpServerConfig
  error?: string
}

export type NeedsAuthMCPServer = {
  name: string
  type: 'needs-auth'
  config: ScopedMcpServerConfig
}

export type PendingMCPServer = {
  name: string
  type: 'pending'
  config: ScopedMcpServerConfig
  reconnectAttempt?: number
  maxReconnectAttempts?: number
}

export type DisabledMCPServer = {
  name: string
  type: 'disabled'
  config: ScopedMcpServerConfig
}

export type MCPServerConnection =
  | ConnectedMCPServer
  | FailedMCPServer
  | NeedsAuthMCPServer
  | PendingMCPServer
  | DisabledMCPServer

// Resource types
export type ServerResource = Resource & { server: string }

// MCP CLI State types
export interface SerializedTool {
  name: string
  description: string
  inputJSONSchema?: {
    [x: string]: unknown
    type: 'object'
    properties?: {
      [x: string]: unknown
    }
  }
  isMcp?: boolean
  originalToolName?: string // Original unnormalized tool name from MCP server
}

export interface SerializedClient {
  name: string
  type: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  capabilities?: ServerCapabilities
}

export interface MCPCliState {
  clients: SerializedClient[]
  configs: Record<string, ScopedMcpServerConfig>
  tools: SerializedTool[]
  resources: Record<string, ServerResource[]>
  normalizedNames?: Record<string, string> // Maps normalized names to original names
}
