import React from 'react'
import {
  createHeadlessSession,
  createHeadlessStore,
  getHeadlessCommands,
  HybridTransport,
  launchRepl,
  SSETransport,
  WebSocketTransport,
} from '@claude-code/cli'
import { enableConfigs } from '../src/utils/config.js'
import { getDefaultAppState } from '../src/state/AppStateStore.js'
import type { Command } from '../src/commands.js'

async function main(): Promise<void> {
  enableConfigs()

  const sampleCommands = [
    {
      type: 'prompt',
      name: 'allowed-prompt',
      description: 'prompt command',
    },
    {
      type: 'prompt',
      name: 'blocked-prompt',
      description: 'blocked prompt command',
      disableNonInteractive: true,
    },
    {
      type: 'local',
      name: 'allowed-local',
      description: 'local command',
      supportsNonInteractive: true,
    },
  ] as unknown as Command[]

  const headlessCommands = getHeadlessCommands(sampleCommands, false)
  if (headlessCommands.length !== 2) {
    throw new Error(
      `Expected 2 headless commands, received ${headlessCommands.length}`,
    )
  }

  const store = createHeadlessStore({
    mcpClients: [],
    mcpCommands: [],
    mcpTools: [],
    toolPermissionContext: getDefaultAppState().toolPermissionContext,
    effort: undefined,
    effectiveModel: null,
  })

  if (!store.getState().toolPermissionContext) {
    throw new Error('createHeadlessStore did not initialize AppState')
  }

  const session = createHeadlessSession({
    commands: sampleCommands,
    disableSlashCommands: false,
    store: {
      mcpClients: [],
      mcpCommands: [],
      mcpTools: [],
      toolPermissionContext: getDefaultAppState().toolPermissionContext,
      effort: undefined,
      effectiveModel: null,
    },
    tools: [],
    sdkMcpConfigs: {},
    agents: [],
    options: {
      continue: undefined,
      resume: undefined,
      resumeSessionAt: undefined,
      verbose: undefined,
      outputFormat: undefined,
      jsonSchema: undefined,
      permissionPromptToolName: undefined,
      allowedTools: undefined,
      thinkingConfig: undefined,
      maxTurns: undefined,
      maxBudgetUsd: undefined,
      taskBudget: undefined,
      systemPrompt: undefined,
      appendSystemPrompt: undefined,
      userSpecifiedModel: undefined,
      fallbackModel: undefined,
      teleport: undefined,
      sdkUrl: undefined,
      replayUserMessages: undefined,
      includePartialMessages: undefined,
      forkSession: undefined,
      rewindFiles: undefined,
      enableAuthStatus: undefined,
      agent: undefined,
      workload: undefined,
    },
  })

  if (session.commands.length !== 2 || !session.store.getState()) {
    throw new Error('createHeadlessSession did not expose headless wiring')
  }

  let rendered = false
  await launchRepl(
    {} as never,
    {
      getFpsMetrics: () => undefined,
      initialState: getDefaultAppState(),
    },
    {} as never,
    async (_root, element) => {
      rendered = React.isValidElement(element)
    },
  )

  if (!rendered) {
    throw new Error('launchRepl did not render a valid React element')
  }

  if (
    typeof SSETransport !== 'function' ||
    typeof WebSocketTransport !== 'function' ||
    typeof HybridTransport !== 'function'
  ) {
    throw new Error('CLI transport exports are incomplete')
  }

  console.log('cli package verification passed')
}

await main()
