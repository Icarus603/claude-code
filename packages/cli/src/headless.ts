import { feature } from 'bun:bundle'
import { getCliHostBindings } from './host.js'
import type { HeadlessStateStore } from './contracts.js'
import type { Command } from '@claude-code/command-runtime/runtime'
import type {
  Tools,
} from '@claude-code/tool-registry/runtime'
import {
  type HeadlessStoreParams,
  type MCPServerConnection,
  type McpCommand,
} from '@claude-code/agent/sessionStores.js'

/**
 * V7 §7.2 SDK boundary placeholder types. Internal headless flow uses
 * them as `unknown`-shaped containers; external SDK consumers may
 * narrow against them. V9-2d marked NOT FEASIBLE to migrate.
 *
 * @public
 */
export type SDKStatus = 'active' | 'idle' | 'error' | string
/** @public */
export type McpSdkServerConfig = unknown
/** @public */
export type AgentDefinition = unknown
/** @public */
export type ThinkingConfig = unknown

// Re-export the agent-owned types so existing SDK consumers keep
// `import { HeadlessStoreParams } from '@claude-code/cli'` working.
export type { HeadlessStoreParams, MCPServerConnection, McpCommand }

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

