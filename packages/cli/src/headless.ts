import { feature } from 'bun:bundle'
import { getCliHostBindings } from './host.js'
import type { HeadlessStateStore } from './contracts.js'
import type { Command } from '@claude-code/command-runtime/runtime'
import type {
  Tool,
  ToolPermissionContext,
  Tools,
} from '@claude-code/tool-registry/runtime'

export type SDKStatus = 'active' | 'idle' | 'error' | string
export type MCPServerConnection = unknown
export type McpCommand = unknown
export type McpSdkServerConfig = unknown
export type AgentDefinition = unknown
export type ThinkingConfig = unknown

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
  sessionStartHooksPromise?: Promise<unknown>
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

function getRequiredCliBindings() {
  const bindings = getCliHostBindings()
  if (!bindings.createHeadlessStore || !bindings.runHeadless) {
    throw new Error(
      'CLI headless bindings are not installed. Install root CLI host bindings before using @claude-code/cli headless runtime APIs.',
    )
  }
  return bindings as Required<
    Pick<typeof bindings, 'createHeadlessStore' | 'runHeadless'>
  >
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

export function createHeadlessStore(
  params: HeadlessStoreParams,
): HeadlessStateStore {
  return getRequiredCliBindings().createHeadlessStore(params)
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
      return getRequiredCliBindings().runHeadless(
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
  getAppState: HeadlessStateStore['getState'],
  setAppState: HeadlessStateStore['setState'],
  commands: Command[],
  tools: Tools,
  sdkMcpConfigs: Record<string, McpSdkServerConfig>,
  agents: AgentDefinition[],
  options: HeadlessRunOptions,
): Promise<void> {
  return getRequiredCliBindings().runHeadless(
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
