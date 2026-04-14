import {
  installMcpRuntimeHostBindings,
  type McpRuntimeHostBindings,
} from '@claude-code/mcp-runtime'
import {
  handleMcpSetServers,
  reconcileMcpServers,
} from '../../cli/mcpServersHandlers.js'
import {
  ChannelMessageNotificationSchema,
  gateChannelServer,
} from './channelNotification.js'
import { fetchClaudeAIMcpConfigsIfEligible } from './claudeai.js'
import * as clientRuntime from './clientRuntime.js'
import {
  performMCPOAuthFlow,
  revokeServerTokens,
} from './auth.js'
import {
  areMcpConfigsAllowedWithEnterpriseMcpConfig,
  dedupClaudeAiMcpServers,
  doesEnterpriseMcpConfigExist,
  filterMcpServersByPolicy,
  getAllMcpConfigs,
  getClaudeCodeMcpConfigs,
  getMcpConfigByName,
  getMcpServerSignature,
  isMcpServerDisabled,
  parseMcpConfig,
  parseMcpConfigFromFilePath,
  setMcpServerEnabled,
} from './config.js'
import {
  runElicitationHooks,
  runElicitationResultHooks,
} from './elicitationHandler.js'
import { setupVscodeSdkMcp } from './vscodeSdkMcp.js'

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
    legacy: {
      ...clientRuntime,
      ChannelMessageNotificationSchema,
      areMcpConfigsAllowedWithEnterpriseMcpConfig,
      dedupClaudeAiMcpServers,
      doesEnterpriseMcpConfigExist,
      fetchClaudeAIMcpConfigsIfEligible,
      filterMcpServersByPolicy,
      gateChannelServer,
      getAllMcpConfigs,
      getClaudeCodeMcpConfigs,
      getMcpConfigByName,
      getMcpServerSignature,
      isMcpServerDisabled,
      parseMcpConfig,
      parseMcpConfigFromFilePath,
      performMCPOAuthFlow,
      revokeServerTokens,
      runElicitationHooks,
      runElicitationResultHooks,
      setMcpServerEnabled,
      setupVscodeSdkMcp,
    } as unknown as Record<string, unknown>,
  }

  installMcpRuntimeHostBindings(bindings)
  installed = true
}

installMcpRuntimeBindings()
