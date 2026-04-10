import { getMcpRuntimeHostBindings } from './host.js'

export {
  connectAll,
  discover,
  executeTool,
  getMcpToolsCommandsAndResources,
  prefetchResources,
  prefetchAllMcpResources,
} from './api.js'

export type MCPResultType = 'toolResult' | 'structuredContent' | 'contentArray'
export type McpDiscoverySnapshot = {
  clients: unknown[]
  tools: unknown[]
  commands: unknown[]
  resources?: Record<string, unknown[]>
}
export type TransformedMCPResult = Record<string, unknown>

type McpLegacyRuntime = {
  McpAuthError: new (...args: any[]) => Error
  McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS: new (
    ...args: any[]
  ) => Error
  isMcpSessionExpiredError: (...args: any[]) => boolean
  getServerCacheKey: (...args: any[]) => string
  clearMcpAuthCache: () => void
  getMcpServerConnectionBatchSize: () => number
  wrapFetchWithTimeout: (...args: any[]) => any
  connectToServer: (...args: any[]) => Promise<any>
  clearServerCache: (...args: any[]) => Promise<any>
  ensureConnectedClient: (...args: any[]) => Promise<any>
  areMcpConfigsEqual: (...args: any[]) => boolean
  mcpToolInputToAutoClassifierInput: (...args: any[]) => any
  fetchToolsForClient: any
  fetchResourcesForClient: any
  fetchCommandsForClient: any
  callIdeRpc: (...args: any[]) => Promise<any>
  reconnectMcpServerImpl: (...args: any[]) => Promise<any>
  setupSdkMcpClients: (...args: any[]) => Promise<any>
  inferCompactSchema: (...args: any[]) => string
  transformMCPResult: (...args: any[]) => Promise<any>
  processMCPResult: (...args: any[]) => Promise<any>
  callMCPToolWithUrlElicitationRetry: (...args: any[]) => Promise<any>
}

function getLegacyRuntime(): McpLegacyRuntime {
  const legacy = getMcpRuntimeHostBindings<
    unknown,
    unknown,
    unknown,
    unknown,
    unknown
  >().legacy
  if (!legacy) {
    throw new Error(
      'MCP runtime legacy bindings have not been installed.',
    )
  }
  return legacy as unknown as McpLegacyRuntime
}

export const McpAuthError = class extends (getLegacyRuntime().McpAuthError) {}

export const McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = class extends (
  getLegacyRuntime().McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
) {}

export function isMcpSessionExpiredError(...args: any[]): boolean {
  return getLegacyRuntime().isMcpSessionExpiredError(...args)
}

export function getServerCacheKey(...args: any[]): string {
  return getLegacyRuntime().getServerCacheKey(...args)
}

export function clearMcpAuthCache(): void {
  return getLegacyRuntime().clearMcpAuthCache()
}

export function getMcpServerConnectionBatchSize(): number {
  return getLegacyRuntime().getMcpServerConnectionBatchSize()
}

export function wrapFetchWithTimeout(...args: any[]): any {
  return getLegacyRuntime().wrapFetchWithTimeout(...args)
}

export const connectToServer = (...args: any[]) =>
  getLegacyRuntime().connectToServer(...args)

export async function clearServerCache(...args: any[]): Promise<any> {
  return getLegacyRuntime().clearServerCache(...args)
}

export async function ensureConnectedClient(...args: any[]): Promise<any> {
  return getLegacyRuntime().ensureConnectedClient(...args)
}

export function areMcpConfigsEqual(...args: any[]): boolean {
  return getLegacyRuntime().areMcpConfigsEqual(...args)
}

export function mcpToolInputToAutoClassifierInput(...args: any[]): any {
  return getLegacyRuntime().mcpToolInputToAutoClassifierInput(...args)
}

export const fetchToolsForClient = Object.assign(
  (...args: any[]) => getLegacyRuntime().fetchToolsForClient(...args),
  {
    cache: {
      clear: (...args: any[]) =>
        getLegacyRuntime().fetchToolsForClient.cache.clear(...args),
      delete: (...args: any[]) =>
        getLegacyRuntime().fetchToolsForClient.cache.delete(...args),
      get: (...args: any[]) =>
        getLegacyRuntime().fetchToolsForClient.cache.get(...args),
      has: (...args: any[]) =>
        getLegacyRuntime().fetchToolsForClient.cache.has(...args),
      set: (...args: any[]) =>
        getLegacyRuntime().fetchToolsForClient.cache.set(...args),
    },
  },
)

export const fetchResourcesForClient = Object.assign(
  (...args: any[]) => getLegacyRuntime().fetchResourcesForClient(...args),
  {
    cache: {
      clear: (...args: any[]) =>
        getLegacyRuntime().fetchResourcesForClient.cache.clear(...args),
      delete: (...args: any[]) =>
        getLegacyRuntime().fetchResourcesForClient.cache.delete(...args),
      get: (...args: any[]) =>
        getLegacyRuntime().fetchResourcesForClient.cache.get(...args),
      has: (...args: any[]) =>
        getLegacyRuntime().fetchResourcesForClient.cache.has(...args),
      set: (...args: any[]) =>
        getLegacyRuntime().fetchResourcesForClient.cache.set(...args),
    },
  },
)

export const fetchCommandsForClient = Object.assign(
  (...args: any[]) => getLegacyRuntime().fetchCommandsForClient(...args),
  {
    cache: {
      clear: (...args: any[]) =>
        getLegacyRuntime().fetchCommandsForClient.cache.clear(...args),
      delete: (...args: any[]) =>
        getLegacyRuntime().fetchCommandsForClient.cache.delete(...args),
      get: (...args: any[]) =>
        getLegacyRuntime().fetchCommandsForClient.cache.get(...args),
      has: (...args: any[]) =>
        getLegacyRuntime().fetchCommandsForClient.cache.has(...args),
      set: (...args: any[]) =>
        getLegacyRuntime().fetchCommandsForClient.cache.set(...args),
    },
  },
)

export async function callIdeRpc(...args: any[]): Promise<any> {
  return getLegacyRuntime().callIdeRpc(...args)
}

export async function reconnectMcpServerImpl(...args: any[]): Promise<any> {
  return getLegacyRuntime().reconnectMcpServerImpl(...args)
}

export async function setupSdkMcpClients(...args: any[]): Promise<any> {
  return getLegacyRuntime().setupSdkMcpClients(...args)
}

export function inferCompactSchema(...args: any[]): string {
  return getLegacyRuntime().inferCompactSchema(...args)
}

export async function transformMCPResult(...args: any[]): Promise<any> {
  return getLegacyRuntime().transformMCPResult(...args)
}

export async function processMCPResult(...args: any[]): Promise<any> {
  return getLegacyRuntime().processMCPResult(...args)
}

export async function callMCPToolWithUrlElicitationRetry(
  ...args: any[]
): Promise<any> {
  return getLegacyRuntime().callMCPToolWithUrlElicitationRetry(...args)
}
