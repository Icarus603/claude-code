import { z } from 'zod/v4'
import {
  clearMcpAuthCache,
  clearServerCache,
  connectToServer,
  ensureConnectedClient,
  fetchCommandsForClient,
  fetchResourcesForClient,
  fetchToolsForClient,
  getMcpServerConnectionBatchSize,
  getServerCacheKey,
  inferCompactSchema,
  isMcpSessionExpiredError,
  mcpToolInputToAutoClassifierInput,
  McpAuthError,
  McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  processMCPResult,
  reconnectMcpServerImpl,
  setupSdkMcpClients,
  transformMCPResult,
  wrapFetchWithTimeout,
  areMcpConfigsEqual,
  callIdeRpc,
  callMCPToolWithUrlElicitationRetry,
} from './client.js'
import { HostBindingsError } from './errors.js'
import { getMcpRuntimeHostBindings } from './host.js'

export type ConfigScope =
  | 'local'
  | 'user'
  | 'project'
  | 'dynamic'
  | 'enterprise'
  | 'claudeai'
  | 'managed'

export type McpSdkServerConfig = {
  type: 'sdk'
  name: string
}

export type McpServerConfig = {
  type?: string
  [key: string]: unknown
}

export type ScopedMcpServerConfig = McpServerConfig & {
  scope: ConfigScope
  pluginSource?: string
}

export type MCPServerConnection = {
  name: string
  type: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  config: ScopedMcpServerConfig
  capabilities?: unknown
  serverInfo?: {
    name: string
    version: string
  }
  instructions?: string
  error?: string
  reconnectAttempt?: number
  maxReconnectAttempts?: number
  client?: unknown
}

export type ServerResource = {
  server: string
  [key: string]: unknown
}

export type ChannelEntry = {
  kind: 'server' | 'plugin'
  name: string
  marketplace?: string
}

const SAFE_META_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/

type McpCompatBindings = {
  fetchClaudeAIMcpConfigsIfEligible?: (...args: any[]) => any
  areMcpConfigsAllowedWithEnterpriseMcpConfig?: (...args: any[]) => any
  dedupClaudeAiMcpServers?: (...args: any[]) => any
  doesEnterpriseMcpConfigExist?: (...args: any[]) => any
  filterMcpServersByPolicy?: (...args: any[]) => any
  getClaudeCodeMcpConfigs?: (...args: any[]) => any
  getMcpServerSignature?: (...args: any[]) => any
  parseMcpConfig?: (...args: any[]) => any
  parseMcpConfigFromFilePath?: (...args: any[]) => any
  getMcpConfigByName?: (...args: any[]) => any
  isMcpServerDisabled?: (...args: any[]) => any
  setMcpServerEnabled?: (...args: any[]) => any
  getAllMcpConfigs?: (...args: any[]) => any
  performMCPOAuthFlow?: (...args: any[]) => any
  revokeServerTokens?: (...args: any[]) => any
  runElicitationHooks?: (...args: any[]) => any
  runElicitationResultHooks?: (...args: any[]) => any
  setupVscodeSdkMcp?: (...args: any[]) => any
  gateChannelServer?: (...args: any[]) => any
  ChannelMessageNotificationSchema?: (...args: any[]) => any
}

function getCompatBindings(): McpCompatBindings {
  const legacy = getMcpRuntimeHostBindings<
    unknown,
    unknown,
    unknown,
    unknown,
    unknown
  >().legacy as McpCompatBindings | undefined

  if (!legacy) {
    throw new HostBindingsError(
      'MCP runtime compatibility bindings have not been installed.',
    )
  }

  return legacy
}

function getCompatFn<T extends (...args: any[]) => any>(name: keyof McpCompatBindings): T {
  const candidate = getCompatBindings()[name]
  if (typeof candidate !== 'function') {
    throw new HostBindingsError(
      `MCP runtime compatibility binding "${String(name)}" has not been installed.`,
    )
  }
  return candidate as T
}

function normalizeNameForMCP(name: string): string {
  const CLAUDEAI_SERVER_PREFIX = 'claude.ai '
  let normalized = name.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (name.startsWith(CLAUDEAI_SERVER_PREFIX)) {
    normalized = normalized.replace(/_+/g, '_').replace(/^_|_$/g, '')
  }
  return normalized
}

export function mcpInfoFromString(toolString: string): {
  serverName: string
  toolName: string | undefined
} | null {
  const parts = toolString.split('__')
  const [mcpPart, serverName, ...toolNameParts] = parts
  if (mcpPart !== 'mcp' || !serverName) {
    return null
  }
  return {
    serverName,
    toolName: toolNameParts.length > 0 ? toolNameParts.join('__') : undefined,
  }
}

export function getMcpPrefix(serverName: string): string {
  return `mcp__${normalizeNameForMCP(serverName)}__`
}

export function filterToolsByServer<T extends { name?: string }>(
  tools: T[],
  serverName: string,
): T[] {
  const prefix = getMcpPrefix(serverName)
  return tools.filter(tool => tool.name?.startsWith(prefix))
}

export function commandBelongsToServer(
  command: { name?: string },
  serverName: string,
): boolean {
  const normalized = normalizeNameForMCP(serverName)
  const name = command.name
  if (!name) return false
  return (
    name.startsWith(`mcp__${normalized}__`) || name.startsWith(`${normalized}:`)
  )
}

export function excludeCommandsByServer<T extends { name?: string }>(
  commands: T[],
  serverName: string,
): T[] {
  return commands.filter(command => !commandBelongsToServer(command, serverName))
}

export function excludeResourcesByServer<T>(
  resources: Record<string, T[]>,
  serverName: string,
): Record<string, T[]> {
  const next = { ...resources }
  delete next[serverName]
  return next
}

export function isXaaEnabled(): boolean {
  return process.env.CLAUDE_CODE_ENABLE_XAA === '1' ||
    process.env.CLAUDE_CODE_ENABLE_XAA === 'true'
}

export function isChannelsEnabled(): boolean {
  return process.env.CLAUDE_CODE_ENABLE_CHANNELS === '1' ||
    process.env.CLAUDE_CODE_ENABLE_CHANNELS === 'true'
}

export function isChannelAllowlisted(pluginSource: string | undefined): boolean {
  return Boolean(pluginSource && pluginSource.includes('@'))
}

export function wrapChannelMessage(
  serverName: string,
  content: string,
  meta?: Record<string, string>,
): string {
  const attrs = Object.entries(meta ?? {})
    .filter(([key]) => SAFE_META_KEY.test(key))
    .map(([key, value]) => ` ${key}="${value.replaceAll('"', '&quot;')}"`)
    .join('')
  return `<channel source="${serverName.replaceAll('"', '&quot;')}"${attrs}>\n${content}\n</channel>`
}

export function findChannelEntry(
  serverName: string,
  channels: readonly ChannelEntry[],
): ChannelEntry | undefined {
  const parts = serverName.split(':')
  return channels.find(channel =>
    channel.kind === 'server'
      ? serverName === channel.name
      : parts[0] === 'plugin' && parts[1] === channel.name,
  )
}

export function ChannelMessageNotificationSchema() {
  const build = getCompatFn<() => ReturnType<typeof z.object>>(
    'ChannelMessageNotificationSchema',
  )
  return build()
}

export function gateChannelServer(...args: any[]): any {
  return getCompatFn<(...a: any[]) => any>('gateChannelServer')(...args)
}

export function fetchClaudeAIMcpConfigsIfEligible(...args: any[]): any {
  return getCompatFn<(...a: any[]) => any>(
    'fetchClaudeAIMcpConfigsIfEligible',
  )(...args)
}

export function areMcpConfigsAllowedWithEnterpriseMcpConfig(
  ...args: any[]
): any {
  return getCompatFn<(...a: any[]) => any>(
    'areMcpConfigsAllowedWithEnterpriseMcpConfig',
  )(...args)
}

export function dedupClaudeAiMcpServers(...args: any[]): any {
  return getCompatFn<(...a: any[]) => any>('dedupClaudeAiMcpServers')(...args)
}

export function doesEnterpriseMcpConfigExist(...args: any[]): any {
  return getCompatFn<(...a: any[]) => any>('doesEnterpriseMcpConfigExist')(
    ...args,
  )
}

export function filterMcpServersByPolicy(...args: any[]): any {
  return getCompatFn<(...a: any[]) => any>('filterMcpServersByPolicy')(
    ...args,
  )
}

export function getClaudeCodeMcpConfigs(...args: any[]): any {
  return getCompatFn<(...a: any[]) => any>('getClaudeCodeMcpConfigs')(...args)
}

export function getMcpServerSignature(...args: any[]): any {
  return getCompatFn<(...a: any[]) => any>('getMcpServerSignature')(...args)
}

export function parseMcpConfig(...args: any[]): any {
  return getCompatFn<(...a: any[]) => any>('parseMcpConfig')(...args)
}

export function parseMcpConfigFromFilePath(...args: any[]): any {
  return getCompatFn<(...a: any[]) => any>('parseMcpConfigFromFilePath')(
    ...args,
  )
}

export function getMcpConfigByName(...args: any[]): any {
  return getCompatFn<(...a: any[]) => any>('getMcpConfigByName')(...args)
}

export function isMcpServerDisabled(...args: any[]): any {
  return getCompatFn<(...a: any[]) => any>('isMcpServerDisabled')(...args)
}

export function setMcpServerEnabled(...args: any[]): any {
  return getCompatFn<(...a: any[]) => any>('setMcpServerEnabled')(...args)
}

export function getAllMcpConfigs(...args: any[]): any {
  return getCompatFn<(...a: any[]) => any>('getAllMcpConfigs')(...args)
}

export function performMCPOAuthFlow(...args: any[]): any {
  return getCompatFn<(...a: any[]) => any>('performMCPOAuthFlow')(...args)
}

export function revokeServerTokens(...args: any[]): any {
  return getCompatFn<(...a: any[]) => any>('revokeServerTokens')(...args)
}

export function runElicitationHooks(...args: any[]): any {
  return getCompatFn<(...a: any[]) => any>('runElicitationHooks')(...args)
}

export function runElicitationResultHooks(...args: any[]): any {
  return getCompatFn<(...a: any[]) => any>('runElicitationResultHooks')(
    ...args,
  )
}

export function setupVscodeSdkMcp(...args: any[]): any {
  return getCompatFn<(...a: any[]) => any>('setupVscodeSdkMcp')(...args)
}

export {
  areMcpConfigsEqual,
  callIdeRpc,
  callMCPToolWithUrlElicitationRetry,
  clearMcpAuthCache,
  clearServerCache,
  connectToServer,
  ensureConnectedClient,
  fetchCommandsForClient,
  fetchResourcesForClient,
  fetchToolsForClient,
  getMcpServerConnectionBatchSize,
  getServerCacheKey,
  inferCompactSchema,
  isMcpSessionExpiredError,
  McpAuthError,
  McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  mcpToolInputToAutoClassifierInput,
  processMCPResult,
  reconnectMcpServerImpl,
  setupSdkMcpClients,
  transformMCPResult,
  wrapFetchWithTimeout,
}
