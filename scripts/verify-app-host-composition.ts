import { getCommandRegistryHostBindings } from '@claude-code/command-registry'
import { getMcpRuntimeHostBindings } from '@claude-code/mcp-runtime'
import { getProviderHostBindings } from '@claude-code/provider'
import { getToolRegistryHostBindings } from '@claude-code/tool-registry'
import '../src/runtime/bootstrap.js'
import '../src/services/api/providerHostSetup.js'
import '../src/commands.js'
import '../src/services/mcp/client.js'
import { createRuntimeHandles } from '../src/runtime/runtimeHandles.js'

async function main(): Promise<void> {
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
    typeof runtimeHandles.sessionStoreFactory.createInteractiveStore !==
      'function' ||
    typeof runtimeHandles.sessionStoreFactory.createHeadlessStore !==
      'function'
  ) {
    throw new Error('Runtime handles are incomplete')
  }

  console.log('app-host composition verification passed')
}

await main()
