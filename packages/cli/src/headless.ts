import { feature } from 'bun:bundle'
import { runHeadless as runHeadlessImpl } from '../../../src/cli/print.js'
import type { Command } from '../../../src/commands.js'
import type { SDKStatus } from '../../../src/entrypoints/agentSdkTypes.js'
import type {
  MCPServerConnection,
  McpCommand,
  McpSdkServerConfig,
} from '../../../src/services/mcp/types.js'
import type { AppState } from '../../../src/state/AppStateStore.js'
import { getDefaultAppState } from '../../../src/state/AppStateStore.js'
import { onChangeAppState } from '../../../src/state/onChangeAppState.js'
import { createStore } from '../../../src/state/store.js'
import type { AgentDefinition } from '../../../src/tools/AgentTool/loadAgentsDir.js'
import type {
  Tool,
  ToolPermissionContext,
  Tools,
} from '../../../src/Tool.js'
import {
  parseEffortValue,
  toPersistableEffort,
} from '../../../src/utils/effort.js'
import {
  getFastModeUnavailableReason,
  isFastModeEnabled,
  isFastModeSupportedByModel,
} from '../../../src/utils/fastMode.js'
import { getInitialSettings } from '../../../src/utils/settings/settings.js'
import type { ThinkingConfig } from '../../../src/utils/thinking.js'

export type HeadlessStoreParams = {
  mcpClients: MCPServerConnection[]
  mcpCommands: McpCommand[]
  mcpTools: Tool[]
  toolPermissionContext: ToolPermissionContext
  effort: string | undefined
  effectiveModel: string | null
  advisorModel?: string
  kairosEnabled?: boolean
}

export type HeadlessRunOptions = {
  continue: boolean | undefined
  resume: string | boolean | undefined
  resumeSessionAt: string | undefined
  verbose: boolean | undefined
  outputFormat: string | undefined
  jsonSchema: Record<string, unknown> | undefined
  permissionPromptToolName: string | undefined
  allowedTools: string[] | undefined
  thinkingConfig: ThinkingConfig | undefined
  maxTurns: number | undefined
  maxBudgetUsd: number | undefined
  taskBudget: { total: number } | undefined
  systemPrompt: string | undefined
  appendSystemPrompt: string | undefined
  userSpecifiedModel: string | undefined
  fallbackModel: string | undefined
  teleport: string | true | null | undefined
  sdkUrl: string | undefined
  replayUserMessages: boolean | undefined
  includePartialMessages: boolean | undefined
  forkSession: boolean | undefined
  rewindFiles: string | undefined
  enableAuthStatus: boolean | undefined
  agent: string | undefined
  workload: string | undefined
  setupTrigger?: 'init' | 'maintenance' | undefined
  sessionStartHooksPromise?: ReturnType<
    typeof import('../../../src/utils/sessionStart.js').processSessionStartHooks
  >
  setSDKStatus?: (status: SDKStatus) => void
}

export type HeadlessSessionParams = {
  commands: Command[]
  disableSlashCommands: boolean
  store: HeadlessStoreParams
  tools: Tools
  sdkMcpConfigs: Record<string, McpSdkServerConfig>
  agents: AgentDefinition[]
  options: HeadlessRunOptions
}

export function getHeadlessCommands(
  commands: Command[],
  disableSlashCommands: boolean,
): Command[] {
  if (disableSlashCommands) {
    return []
  }
  return commands.filter(
    command =>
      (command.type === 'prompt' && !command.disableNonInteractive) ||
      (command.type === 'local' && command.supportsNonInteractive),
  )
}

export function createHeadlessStore(params: HeadlessStoreParams) {
  const defaultState = getDefaultAppState()
  const initialSettings = getInitialSettings()
  const initialEffortValue =
    parseEffortValue(params.effort) ??
    toPersistableEffort(initialSettings.effortLevel)
  const initialFastMode =
    isFastModeEnabled() &&
    getFastModeUnavailableReason() === null &&
    isFastModeSupportedByModel(params.effectiveModel) &&
    !initialSettings.fastModePerSessionOptIn &&
    initialSettings.fastMode === true
  const initialState: AppState = {
    ...defaultState,
    mcp: {
      ...defaultState.mcp,
      clients: params.mcpClients,
      commands: params.mcpCommands,
      tools: params.mcpTools,
    },
    toolPermissionContext: params.toolPermissionContext,
    effortValue: initialEffortValue,
    ...(isFastModeEnabled() ? { fastMode: initialFastMode } : {}),
    ...(params.advisorModel ? { advisorModel: params.advisorModel } : {}),
    ...(feature('KAIROS') && params.kairosEnabled !== undefined
      ? { kairosEnabled: params.kairosEnabled }
      : {}),
  }

  return createStore(initialState, onChangeAppState)
}

export function createHeadlessSession(params: HeadlessSessionParams) {
  const commands = getHeadlessCommands(
    params.commands,
    params.disableSlashCommands,
  )
  const store = createHeadlessStore(params.store)

  return {
    commands,
    store,
    run(inputPrompt: string | AsyncIterable<string>) {
      return runHeadlessImpl(
        inputPrompt,
        () => store.getState(),
        store.setState,
        commands,
        params.tools,
        params.sdkMcpConfigs,
        params.agents,
        params.options,
      )
    },
  }
}

export async function runHeadless(
  inputPrompt: string | AsyncIterable<string>,
  getAppState: Parameters<typeof runHeadlessImpl>[1],
  setAppState: Parameters<typeof runHeadlessImpl>[2],
  commands: Parameters<typeof runHeadlessImpl>[3],
  tools: Parameters<typeof runHeadlessImpl>[4],
  sdkMcpConfigs: Parameters<typeof runHeadlessImpl>[5],
  agents: Parameters<typeof runHeadlessImpl>[6],
  options: Parameters<typeof runHeadlessImpl>[7],
): Promise<void> {
  return runHeadlessImpl(
    inputPrompt,
    getAppState,
    setAppState,
    commands,
    tools,
    sdkMcpConfigs,
    agents,
    options,
  )
}
