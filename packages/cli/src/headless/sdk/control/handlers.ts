import { feature } from 'bun:bundle'
import {
  getAutoModeUnavailableNotification,
  getAutoModeUnavailableReason,
  isAutoModeGateEnabled,
  isBypassPermissionsModeDisabled,
  transitionPermissionMode,
} from '@claude-code/permission'
import {
  getSettings_DEPRECATED,
} from '@claude-code/config/settings'
import {
  ChannelMessageNotificationSchema,
  findChannelEntry,
  gateChannelServer,
  type MCPServerConnection,
  wrapChannelMessage,
} from '@claude-code/mcp-runtime'
import type { ToolPermissionContext } from '../../../../../../src/Tool.js'
import type { Stream } from '../../../../../../src/utils/stream.js'
import type {
  StdoutMessage,
  SDKControlInitializeRequest,
  SDKControlInitializeResponse,
} from '../../../../../../src/entrypoints/sdk/controlTypes.js'
import type {
  AgentDefinition,
} from '../../../../../../src/tools/AgentTool/loadAgentsDir.js'
import { isBuiltInAgent, parseAgentsFromJson } from '../../../../../../src/tools/AgentTool/loadAgentsDir.js'
import type { Command } from '../../../../../../src/commands.js'
import {
  formatDescriptionWithSource,
  getCommandName,
} from '../../../../../../src/commands.js'
import type { ModelInfo } from '../../../../../../src/entrypoints/agentSdkTypes.js'
import type { HookCallbackMatcher } from '../../../../../../src/types/hooks.js'
import type { HookEvent } from '../../../../../../src/entrypoints/agentSdkTypes.js'
import type { PermissionMode as InternalPermissionMode } from '../../../../../../src/types/permissions.js'
import type { AppState } from '../../../../../../src/state/AppStateStore.js'
import { parsePluginIdentifier } from '../../../../../../src/utils/plugins/pluginIdentifier.js'
import {
  getSessionId,
  setMainLoopModelOverride,
  setMainThreadAgentType,
  getMainThreadAgentType,
  getAllowedChannels,
  setAllowedChannels,
  type ChannelEntry,
  registerHookCallbacks,
  setInitJsonSchema,
} from '../../../../../../src/bootstrap/state.js'
import {
  DEFAULT_OUTPUT_STYLE_NAME,
  getAllOutputStyles,
} from '../../../../../../src/constants/outputStyles.js'
import { getAccountInformation } from '../../../../../../src/utils/auth.js'
import { getAPIProvider } from '../../../../../../src/utils/model/providers.js'
import {
  isFastModeEnabled,
  isFastModeAvailable,
  getFastModeState,
} from '../../../../../../src/utils/fastMode.js'
import { AwsAuthStatusManager } from '../../../../../../src/utils/awsAuthStatusManager.js'
import { parseUserSpecifiedModel } from '../../../../../../src/utils/model/model.js'
import { logMCPDebug } from '../../../../../../src/utils/log.js'
import { logEvent } from '@claude-code/local-observability'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '@claude-code/local-observability/compat'
import { enqueue } from '../../../../../../src/utils/messageQueueManager.js'
import { getCwd } from '../../../../../../src/utils/cwd.js'
import { randomUUID } from 'crypto'
import { StructuredIO } from '../../../../../../src/cli/structuredIO.js'

export async function handleInitializeRequest(
  request: SDKControlInitializeRequest,
  requestId: string,
  initialized: boolean,
  output: Stream<StdoutMessage>,
  commands: Command[],
  modelInfos: ModelInfo[],
  structuredIO: StructuredIO,
  enableAuthStatus: boolean,
  options: {
    systemPrompt: string | undefined
    appendSystemPrompt: string | undefined
    agent?: string | undefined
    userSpecifiedModel?: string | undefined
    [key: string]: unknown
  },
  agents: AgentDefinition[],
  getAppState: () => AppState,
): Promise<void> {
  if (initialized) {
    output.enqueue({
      type: 'control_response',
      response: {
        subtype: 'error',
        error: 'Already initialized',
        request_id: requestId,
        pending_permission_requests:
          structuredIO.getPendingPermissionRequests(),
      },
    })
    return
  }

  // Apply systemPrompt/appendSystemPrompt from stdin to avoid ARG_MAX limits
  if (request.systemPrompt !== undefined) {
    options.systemPrompt = request.systemPrompt
  }
  if (request.appendSystemPrompt !== undefined) {
    options.appendSystemPrompt = request.appendSystemPrompt
  }
  if (request.promptSuggestions !== undefined) {
    options.promptSuggestions = request.promptSuggestions
  }

  // Merge agents from stdin to avoid ARG_MAX limits
  if (request.agents) {
    const stdinAgents = parseAgentsFromJson(request.agents, 'flagSettings')
    agents.push(...stdinAgents)
  }

  // Re-evaluate main thread agent after SDK agents are merged
  // This allows --agent to reference agents defined via SDK
  if (options.agent) {
    // If main.tsx already found this agent (filesystem-defined), it already
    // applied systemPrompt/model/initialPrompt. Skip to avoid double-apply.
    const alreadyResolved = getMainThreadAgentType() === options.agent
    const mainThreadAgent = agents.find(a => a.agentType === options.agent)
    if (mainThreadAgent && !alreadyResolved) {
      // Update the main thread agent type in bootstrap state
      setMainThreadAgentType(mainThreadAgent.agentType)

      // Apply the agent's system prompt if user hasn't specified a custom one
      // SDK agents are always custom agents (not built-in), so getSystemPrompt() takes no args
      if (!options.systemPrompt && !isBuiltInAgent(mainThreadAgent)) {
        const agentSystemPrompt = mainThreadAgent.getSystemPrompt()
        if (agentSystemPrompt) {
          options.systemPrompt = agentSystemPrompt
        }
      }

      // Apply the agent's model if user didn't specify one and agent has a model
      if (
        !options.userSpecifiedModel &&
        mainThreadAgent.model &&
        mainThreadAgent.model !== 'inherit'
      ) {
        const agentModel = parseUserSpecifiedModel(mainThreadAgent.model)
        setMainLoopModelOverride(agentModel)
      }

      // SDK-defined agents arrive via init, so main.tsx's lookup missed them.
      if (mainThreadAgent.initialPrompt) {
        structuredIO.prependUserMessage(mainThreadAgent.initialPrompt)
      }
    } else if (mainThreadAgent?.initialPrompt) {
      // Filesystem-defined agent (alreadyResolved by main.tsx). main.tsx
      // handles initialPrompt for the string inputPrompt case, but when
      // inputPrompt is an AsyncIterable (SDK stream-json), it can't
      // concatenate — fall back to prependUserMessage here.
      structuredIO.prependUserMessage(mainThreadAgent.initialPrompt)
    }
  }

  const settings = getSettings_DEPRECATED()
  const outputStyle = settings?.outputStyle || DEFAULT_OUTPUT_STYLE_NAME
  const availableOutputStyles = await getAllOutputStyles(getCwd())

  // Get account information
  const accountInfo = getAccountInformation()
  if (request.hooks) {
    const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {}
    for (const [event, matchers] of Object.entries(request.hooks) as [string, Array<{ hookCallbackIds: string[]; timeout?: number; matcher?: string }>][]) {
      hooks[event as HookEvent] = matchers.map(matcher => {
        const callbacks = matcher.hookCallbackIds.map(callbackId => {
          return structuredIO.createHookCallback(callbackId, matcher.timeout)
        })
        return {
          matcher: matcher.matcher,
          hooks: callbacks,
        }
      })
    }
    registerHookCallbacks(hooks)
  }
  if (request.jsonSchema) {
    setInitJsonSchema(request.jsonSchema)
  }
  const initResponse: SDKControlInitializeResponse = {
    commands: commands
      .filter(cmd => cmd.userInvocable !== false)
      .map(cmd => ({
        name: getCommandName(cmd),
        description: formatDescriptionWithSource(cmd),
        argumentHint: cmd.argumentHint || '',
      })),
    agents: agents.map(agent => ({
      name: agent.agentType,
      description: agent.whenToUse,
      // 'inherit' is an internal sentinel; normalize to undefined for the public API
      model: agent.model === 'inherit' ? undefined : agent.model,
    })),
    output_style: outputStyle,
    available_output_styles: Object.keys(availableOutputStyles),
    models: modelInfos,
    account: {
      email: accountInfo?.email,
      organization: accountInfo?.organization,
      subscriptionType: accountInfo?.subscription,
      tokenSource: accountInfo?.tokenSource,
      apiKeySource: accountInfo?.apiKeySource,
      // getAccountInformation() returns undefined under 3P providers, so the
      // other fields are all absent. apiProvider disambiguates "not logged
      // in" (firstParty + tokenSource:none) from "3P, login not applicable".
      apiProvider: getAPIProvider(),
    },
    pid: process.pid,
  }

  if (isFastModeEnabled() && isFastModeAvailable()) {
    const appState = getAppState()
    initResponse.fast_mode_state = getFastModeState(
      options.userSpecifiedModel ?? null,
      appState.fastMode,
    )
  }

  output.enqueue({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: initResponse,
    },
  })

  // After the initialize message, check the auth status-
  // This will get notified of changes, but we also want to send the
  // initial state.
  if (enableAuthStatus) {
    const authStatusManager = AwsAuthStatusManager.getInstance()
    const status = authStatusManager.getStatus()
    if (status) {
      output.enqueue({
        type: 'auth_status',
        isAuthenticating: status.isAuthenticating,
        output: status.output,
        error: status.error,
        uuid: randomUUID(),
        session_id: getSessionId(),
      })
    }
  }
}

export function handleSetPermissionMode(
  request: { mode: InternalPermissionMode },
  requestId: string,
  toolPermissionContext: ToolPermissionContext,
  output: Stream<StdoutMessage>,
): ToolPermissionContext {
  // Check if trying to switch to bypassPermissions mode
  if (request.mode === 'bypassPermissions') {
    if (isBypassPermissionsModeDisabled()) {
      output.enqueue({
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id: requestId,
          error:
            'Cannot set permission mode to bypassPermissions because it is disabled by settings or configuration',
        },
      })
      return toolPermissionContext
    }
    if (!toolPermissionContext.isBypassPermissionsModeAvailable) {
      output.enqueue({
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id: requestId,
          error:
            'Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions',
        },
      })
      return toolPermissionContext
    }
  }

  // Check if trying to switch to auto mode without the classifier gate
  if (
    feature('TRANSCRIPT_CLASSIFIER') &&
    request.mode === 'auto' &&
    !isAutoModeGateEnabled()
  ) {
    const reason = getAutoModeUnavailableReason()
    output.enqueue({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: requestId,
        error: reason
          ? `Cannot set permission mode to auto: ${getAutoModeUnavailableNotification(reason)}`
          : 'Cannot set permission mode to auto',
      },
    })
    return toolPermissionContext
  }

  // Allow the mode switch
  output.enqueue({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: {
        mode: request.mode,
      },
    },
  })

  return {
    ...transitionPermissionMode(
      toolPermissionContext.mode,
      request.mode,
      toolPermissionContext,
    ),
    mode: request.mode,
  }
}

/**
 * IDE-triggered channel enable. Derives the ChannelEntry from the connection's
 * pluginSource (IDE can't spoof kind/marketplace — we only take the server
 * name), appends it to session allowedChannels, and runs the full gate. On
 * gate failure, rolls back the append. On success, registers a notification
 * handler that enqueues channel messages at priority:'next' — drainCommandQueue
 * picks them up between turns.
 *
 * Intentionally does NOT register the claude/channel/permission handler that
 * useManageMCPConnections sets up for interactive mode. That handler resolves
 * a pending dialog inside handleInteractivePermission — but print.ts never
 * calls handleInteractivePermission. When SDK permission lands on 'ask', it
 * goes to the consumer's canUseTool callback over stdio; there is no CLI-side
 * dialog for a remote "yes tbxkq" to resolve. If an IDE wants channel-relayed
 * tool approval, that's IDE-side plumbing against its own pending-map. (Also
 * gated separately by tengu_harbor_permissions — not yet shipping on
 * interactive either.)
 */
export function handleChannelEnable(
  requestId: string,
  serverName: string,
  connectionPool: readonly MCPServerConnection[],
  output: Stream<StdoutMessage>,
): void {
  const respondError = (error: string) =>
    output.enqueue({
      type: 'control_response',
      response: { subtype: 'error', request_id: requestId, error },
    })

  if (!(feature('KAIROS') || feature('KAIROS_CHANNELS'))) {
    return respondError('channels feature not available in this build')
  }

  // Only a 'connected' client has .capabilities and .client to register the
  // handler on. The pool spread at the call site matches mcp_status.
  const connection = connectionPool.find(
    c => c.name === serverName && c.type === 'connected',
  )
  if (!connection || connection.type !== 'connected') {
    return respondError(`server ${serverName} is not connected`)
  }

  const pluginSource = connection.config.pluginSource
  const parsed = pluginSource ? parsePluginIdentifier(pluginSource) : undefined
  if (!parsed?.marketplace) {
    // No pluginSource or @-less source — can never pass the {plugin,
    // marketplace}-keyed allowlist. Short-circuit with the same reason the
    // gate would produce.
    return respondError(
      `server ${serverName} is not plugin-sourced; channel_enable requires a marketplace plugin`,
    )
  }

  const entry: ChannelEntry = {
    kind: 'plugin',
    name: parsed.name,
    marketplace: parsed.marketplace,
  }
  // Idempotency: don't double-append on repeat enable.
  const prior = getAllowedChannels()
  const already = prior.some(
    e =>
      e.kind === 'plugin' &&
      e.name === entry.name &&
      e.marketplace === entry.marketplace,
  )
  if (!already) setAllowedChannels([...prior, entry])

  const gate = gateChannelServer(
    serverName,
    connection.capabilities,
    pluginSource,
  )
  if (gate.action === 'skip') {
    // Rollback — only remove the entry we appended.
    if (!already) setAllowedChannels(prior)
    return respondError(gate.reason)
  }

  const pluginId =
    `${entry.name}@${entry.marketplace}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  logMCPDebug(serverName, 'Channel notifications registered')
  logEvent('tengu_mcp_channel_enable', { plugin: pluginId })

  // Identical enqueue shape to the interactive register block in
  // useManageMCPConnections. drainCommandQueue processes it between turns —
  // channel messages queue at priority 'next' and are seen by the model on
  // the turn after they arrive.
  connection.client.setNotificationHandler(
    ChannelMessageNotificationSchema(),
    async notification => {
      const { content, meta } = notification.params
      logMCPDebug(
        serverName,
        `notifications/claude/channel: ${content.slice(0, 80)}`,
      )
      logEvent('tengu_mcp_channel_message', {
        content_length: content.length,
        meta_key_count: Object.keys(meta ?? {}).length,
        entry_kind:
          'plugin' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        is_dev: false,
        plugin: pluginId,
      })
      enqueue({
        mode: 'prompt',
        value: wrapChannelMessage(serverName, content, meta),
        priority: 'next',
        isMeta: true,
        origin: { kind: 'channel', server: serverName } as unknown as string,
        skipSlashCommands: true,
      })
    },
  )

  output.enqueue({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: undefined,
    },
  })
}

/**
 * Re-register the channel notification handler after mcp_reconnect /
 * mcp_toggle creates a new client. handleChannelEnable bound the handler to
 * the OLD client object; allowedChannels survives the reconnect but the
 * handler binding does not. Without this, channel messages silently drop
 * after a reconnect while the IDE still believes the channel is live.
 *
 * Mirrors the interactive CLI's onConnectionAttempt in
 * useManageMCPConnections, which re-gates on every new connection. Paired
 * with registerElicitationHandlers at the same call sites.
 *
 * No-op if the server was never channel-enabled: gateChannelServer calls
 * findChannelEntry internally and returns skip/session for an unlisted
 * server, so reconnecting a non-channel MCP server costs one feature-flag
 * check.
 */
export function reregisterChannelHandlerAfterReconnect(
  connection: MCPServerConnection,
): void {
  if (!(feature('KAIROS') || feature('KAIROS_CHANNELS'))) return
  if (connection.type !== 'connected') return

  const gate = gateChannelServer(
    connection.name,
    connection.capabilities,
    connection.config.pluginSource,
  )
  if (gate.action !== 'register') return

  const entry = findChannelEntry(connection.name, getAllowedChannels())
  const pluginId =
    entry?.kind === 'plugin'
      ? (`${entry.name}@${entry.marketplace}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
      : undefined

  logMCPDebug(
    connection.name,
    'Channel notifications re-registered after reconnect',
  )
  connection.client.setNotificationHandler(
    ChannelMessageNotificationSchema(),
    async notification => {
      const { content, meta } = notification.params
      logMCPDebug(
        connection.name,
        `notifications/claude/channel: ${content.slice(0, 80)}`,
      )
      logEvent('tengu_mcp_channel_message', {
        content_length: content.length,
        meta_key_count: Object.keys(meta ?? {}).length,
        entry_kind:
          entry?.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        is_dev: entry?.dev ?? false,
        plugin: pluginId,
      })
      enqueue({
        mode: 'prompt',
        value: wrapChannelMessage(connection.name, content, meta),
        priority: 'next',
        isMeta: true,
        origin: { kind: 'channel', server: connection.name } as unknown as string,
        skipSlashCommands: true,
      })
    },
  )
}
