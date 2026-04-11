/**
 * SDK-side MCP set-servers handlers. Moved from src/cli/print.ts per
 * V7 §10.2 Cut 5. This file is the root implementation; the contract
 * is declared in @claude-code/mcp-runtime and wired through
 * installMcpRuntimeBindings (see src/services/mcp/runtimeHostSetup.ts).
 */
import type {
  DynamicMcpState as DynamicMcpStateBase,
  McpSetServersResult as McpSetServersResultBase,
  SdkMcpState as SdkMcpStateBase,
} from '@claude-code/mcp-runtime'
import { toScopedConfig } from '@claude-code/mcp-runtime'
import type {
  McpServerConfigForProcessTransport,
  McpSdkServerConfig,
} from '../entrypoints/agentSdkTypes.js'
import type { SDKControlMcpSetServersResponse } from '../entrypoints/sdk/controlTypes.js'
import {
  areMcpConfigsEqual,
  clearServerCache,
  connectToServer,
  fetchToolsForClient,
} from '../services/mcp/client.js'
import { filterMcpServersByPolicy } from '../services/mcp/config.js'
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
} from '../services/mcp/types.js'
import type { AppState } from '../state/AppStateStore.js'
import type { Tools } from '../Tool.js'
import { toError } from '../utils/errors.js'
import { logError } from '../utils/log.js'

export type DynamicMcpState = DynamicMcpStateBase<
  MCPServerConnection,
  Tools,
  ScopedMcpServerConfig
>

export type SdkMcpState = SdkMcpStateBase<
  MCPServerConnection,
  Tools,
  McpSdkServerConfig
>

export type McpSetServersResult = McpSetServersResultBase<
  SDKControlMcpSetServersResponse,
  MCPServerConnection,
  Tools,
  ScopedMcpServerConfig,
  McpSdkServerConfig
>

/**
 * Handles mcp_set_servers requests by processing both SDK and process-based servers.
 * SDK servers run in the SDK process; process-based servers are spawned by the CLI.
 *
 * Applies enterprise allowedMcpServers/deniedMcpServers policy — same filter as
 * --mcp-config (see filterMcpServersByPolicy call in main.tsx). Without this,
 * SDK V2 Query.setMcpServers() was a second policy bypass vector. Blocked servers
 * are reported in response.errors so the SDK consumer knows why they weren't added.
 */
export async function handleMcpSetServers(
  servers: Record<string, McpServerConfigForProcessTransport>,
  sdkState: SdkMcpState,
  dynamicState: DynamicMcpState,
  setAppState: (f: (prev: AppState) => AppState) => void,
): Promise<McpSetServersResult> {
  // Enforce enterprise MCP policy on process-based servers (stdio/http/sse).
  // Mirrors the --mcp-config filter in main.tsx — both user-controlled injection
  // paths must have the same gate. type:'sdk' servers are exempt (SDK-managed,
  // CLI never spawns/connects for them — see filterMcpServersByPolicy jsdoc).
  // Blocked servers go into response.errors so the SDK caller sees why.
  const { allowed: allowedServers, blocked } = filterMcpServersByPolicy(servers)
  const policyErrors: Record<string, string> = {}
  for (const name of blocked) {
    policyErrors[name] =
      'Blocked by enterprise policy (allowedMcpServers/deniedMcpServers)'
  }

  // Separate SDK servers from process-based servers
  const sdkServers: Record<string, McpSdkServerConfig> = {}
  const processServers: Record<string, McpServerConfigForProcessTransport> = {}

  for (const [name, config] of Object.entries(allowedServers)) {
    if ((config.type as string) === 'sdk') {
      sdkServers[name] = config as unknown as McpSdkServerConfig
    } else {
      processServers[name] = config
    }
  }

  // Handle SDK servers
  const currentSdkNames = new Set(Object.keys(sdkState.configs))
  const newSdkNames = new Set(Object.keys(sdkServers))
  const sdkAdded: string[] = []
  const sdkRemoved: string[] = []

  const newSdkConfigs = { ...sdkState.configs }
  let newSdkClients = [...sdkState.clients]
  let newSdkTools = [...sdkState.tools]

  // Remove SDK servers no longer in desired state
  for (const name of currentSdkNames) {
    if (!newSdkNames.has(name)) {
      const client = newSdkClients.find(c => c.name === name)
      if (client && client.type === 'connected') {
        await client.cleanup()
      }
      newSdkClients = newSdkClients.filter(c => c.name !== name)
      const prefix = `mcp__${name}__`
      newSdkTools = newSdkTools.filter(t => !t.name.startsWith(prefix))
      delete newSdkConfigs[name]
      sdkRemoved.push(name)
    }
  }

  // Add new SDK servers as pending - they'll be upgraded to connected
  // when updateSdkMcp() runs on the next query
  for (const [name, config] of Object.entries(sdkServers)) {
    if (!currentSdkNames.has(name)) {
      newSdkConfigs[name] = config
      const pendingClient: MCPServerConnection = {
        type: 'pending',
        name,
        config: { ...config, scope: 'dynamic' as const },
      }
      newSdkClients = [...newSdkClients, pendingClient]
      sdkAdded.push(name)
    }
  }

  // Handle process-based servers
  const processResult = await reconcileMcpServers(
    processServers,
    dynamicState,
    setAppState,
  )

  return {
    response: {
      added: [...sdkAdded, ...processResult.response.added],
      removed: [...sdkRemoved, ...processResult.response.removed],
      errors: { ...policyErrors, ...processResult.response.errors },
    },
    newSdkState: {
      configs: newSdkConfigs,
      clients: newSdkClients,
      tools: newSdkTools,
    },
    newDynamicState: processResult.newState,
    sdkServersChanged: sdkAdded.length > 0 || sdkRemoved.length > 0,
  }
}

/**
 * Reconciles the current set of dynamic MCP servers with a new desired state.
 * Handles additions, removals, and config changes.
 */
export async function reconcileMcpServers(
  desiredConfigs: Record<string, McpServerConfigForProcessTransport>,
  currentState: DynamicMcpState,
  setAppState: (f: (prev: AppState) => AppState) => void,
): Promise<{
  response: SDKControlMcpSetServersResponse
  newState: DynamicMcpState
}> {
  const currentNames = new Set(Object.keys(currentState.configs))
  const desiredNames = new Set(Object.keys(desiredConfigs))

  const toRemove = [...currentNames].filter(n => !desiredNames.has(n))
  const toAdd = [...desiredNames].filter(n => !currentNames.has(n))

  // Check for config changes (same name, different config)
  const toCheck = [...currentNames].filter(n => desiredNames.has(n))
  const toReplace = toCheck.filter(name => {
    const currentConfig = currentState.configs[name]
    const desiredConfigRaw = desiredConfigs[name]
    if (!currentConfig || !desiredConfigRaw) return true
    const desiredConfig = toScopedConfig(desiredConfigRaw) as ScopedMcpServerConfig
    return !areMcpConfigsEqual(currentConfig, desiredConfig)
  })

  const removed: string[] = []
  const added: string[] = []
  const errors: Record<string, string> = {}

  let newClients = [...currentState.clients]
  let newTools = [...currentState.tools]

  // Remove old servers (including ones being replaced)
  for (const name of [...toRemove, ...toReplace]) {
    const client = newClients.find(c => c.name === name)
    const config = currentState.configs[name]
    if (client && config) {
      if (client.type === 'connected') {
        try {
          await client.cleanup()
        } catch (e) {
          logError(e)
        }
      }
      // Clear the memoization cache
      await clearServerCache(name, config)
    }

    // Remove tools from this server
    const prefix = `mcp__${name}__`
    newTools = newTools.filter(t => !t.name.startsWith(prefix))

    // Remove from clients list
    newClients = newClients.filter(c => c.name !== name)

    // Track removal (only for actually removed, not replaced)
    if (toRemove.includes(name)) {
      removed.push(name)
    }
  }

  // Add new servers (including replacements)
  for (const name of [...toAdd, ...toReplace]) {
    const config = desiredConfigs[name]
    if (!config) continue
    const scopedConfig = toScopedConfig(config) as ScopedMcpServerConfig

    // SDK servers are managed by the SDK process, not the CLI.
    // Just track them without trying to connect.
    if ((config.type as string) === 'sdk') {
      added.push(name)
      continue
    }

    try {
      const client = await connectToServer(name, scopedConfig)
      newClients.push(client)

      if (client.type === 'connected') {
        const serverTools = await fetchToolsForClient(client)
        newTools.push(...serverTools)
      } else if (client.type === 'failed') {
        errors[name] = client.error || 'Connection failed'
      }

      added.push(name)
    } catch (e) {
      const err = toError(e)
      errors[name] = err.message
      logError(err)
    }
  }

  // Build new configs
  const newConfigs: Record<string, ScopedMcpServerConfig> = {}
  for (const name of desiredNames) {
    const config = desiredConfigs[name]
    if (config) {
      newConfigs[name] = toScopedConfig(config) as ScopedMcpServerConfig
    }
  }

  const newState: DynamicMcpState = {
    clients: newClients,
    tools: newTools,
    configs: newConfigs,
  }

  // Update AppState with the new tools
  setAppState(prev => {
    // Get all dynamic server names (current + new)
    const allDynamicServerNames = new Set([
      ...Object.keys(currentState.configs),
      ...Object.keys(newConfigs),
    ])

    // Remove old dynamic tools
    const nonDynamicTools = prev.mcp.tools.filter(t => {
      for (const serverName of allDynamicServerNames) {
        if (t.name.startsWith(`mcp__${serverName}__`)) {
          return false
        }
      }
      return true
    })

    // Remove old dynamic clients
    const nonDynamicClients = prev.mcp.clients.filter(c => {
      return !allDynamicServerNames.has(c.name)
    })

    return {
      ...prev,
      mcp: {
        ...prev.mcp,
        tools: [...nonDynamicTools, ...newTools],
        clients: [...nonDynamicClients, ...newClients],
      },
    }
  })

  return {
    response: { added, removed, errors },
    newState,
  }
}
