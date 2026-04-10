import { readFile } from 'fs/promises'
import { getCommandRegistryHostBindings } from '@claude-code/command-registry'
import { getMcpRuntimeHostBindings } from '@claude-code/mcp-runtime'
import { getProviderHostBindings } from '@claude-code/provider'
import { getToolRegistryHostBindings } from '@claude-code/tool-registry'
import '../src/runtime/bootstrap.js'
import '../src/services/api/providerHostSetup.js'
import '../src/commands.js'
import '../src/services/mcp/client.js'
import { createRuntimeHandles } from '../src/runtime/runtimeHandles.js'
import { createInteractiveHost } from '@claude-code/app-host'

async function main(): Promise<void> {
  const [mainContent, replLauncherContent] = await Promise.all([
    readFile('src/main.tsx', 'utf8'),
    readFile('src/replLauncher.tsx', 'utf8'),
  ])

  const providerHost = getProviderHostBindings()
  if (typeof providerHost.getAPIProvider !== 'function') {
    throw new Error('Provider host bindings are not installed')
  }

  const commandHost = getCommandRegistryHostBindings()
  if (typeof commandHost.getCommands !== 'function') {
    throw new Error('Command runtime host bindings are not installed')
  }

  const toolHost = getToolRegistryHostBindings()
  if (typeof toolHost.discoverBuiltInTools !== 'function') {
    throw new Error('Tool registry host bindings are not installed')
  }

  const mcpHost = getMcpRuntimeHostBindings()
  if (typeof mcpHost.getMcpToolsCommandsAndResources !== 'function') {
    throw new Error('MCP runtime host bindings are not installed')
  }

  const runtimeHandles = createRuntimeHandles()
  if (
    typeof runtimeHandles.permission.getContext !== 'function' ||
    typeof runtimeHandles.mcp.getSnapshot !== 'function' ||
    typeof runtimeHandles.plugins.getSnapshot !== 'function' ||
    typeof runtimeHandles.agentCatalog.getDefinitions !== 'function' ||
    typeof runtimeHandles.sessionStoreFactory.createHeadlessStore !==
      'function'
  ) {
    throw new Error('Runtime handles are incomplete')
  }

  const interactiveHost = createInteractiveHost(
    ({ runtimeGraph }) => ({ runtimeGraph }),
    runtimeHandles,
  )
  const interactiveSession = interactiveHost.createSession({
    initialAppState: {
      toolPermissionContext: runtimeHandles.permission.getContext(),
      mcp: {
        clients: [],
        tools: [],
        commands: [],
        resources: {},
        pluginReconnectKey: 0,
      },
      plugins: {
        enabled: [],
        disabled: [],
        commands: [],
        errors: [],
        installationStatus: {
          marketplaces: [],
          plugins: [],
        },
        needsRefresh: false,
      },
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
  })
  if (
    typeof interactiveSession.store.getState !== 'function' ||
    typeof interactiveSession.syncFromStore !== 'function' ||
    typeof interactiveSession.getRuntimeHandles !== 'function'
  ) {
    throw new Error('Interactive host session is incomplete')
  }

  const requiredMainSeams = [
    'createInteractiveHost',
    'interactiveHost.createSession(',
    'launchInteractiveSession(',
    'createHeadlessHost',
  ]
  for (const seam of requiredMainSeams) {
    if (!mainContent.includes(seam)) {
      throw new Error(`main.tsx missing app-host composition seam: ${seam}`)
    }
  }

  const requiredLauncherSeams = [
    'session.store',
    'session.runtimeGraph',
    'store={session.store}',
  ]
  for (const seam of requiredLauncherSeams) {
    if (!replLauncherContent.includes(seam)) {
      throw new Error(
        `replLauncher.tsx missing interactive host composition seam: ${seam}`,
      )
    }
  }

  const disallowedLauncherSeams = [
    'sessionStoreFactory.createInteractiveStore',
    'syncRuntimeHandlesFromAppState',
  ]
  for (const seam of disallowedLauncherSeams) {
    if (replLauncherContent.includes(seam)) {
      throw new Error(
        `replLauncher.tsx still owns interactive session assembly: ${seam}`,
      )
    }
  }

  console.log('app-host composition verification passed')
}

await main()
