import { readFile } from 'fs/promises'
import { getCommandRegistryHostBindings } from '@claude-code/command-runtime'
import { getMcpRuntimeHostBindings } from '@claude-code/mcp-runtime'
import '../src/runtime/bootstrap.js'
import '../src/commands.js'
import '../src/services/mcp/client.js'

async function main(): Promise<void> {
  const [mainContent, replContent, printContent, modeDispatchContent] = await Promise.all([
    readFile('./src/main.tsx', 'utf8'),
    readFile('./src/screens/REPL.tsx', 'utf8'),
    readFile('./src/cli/print.ts', 'utf8'),
    readFile('./packages/cli/src/entry/mode-dispatch.ts', 'utf8'),
  ])

  // V7 §10.1: main.tsx is the thin host — it only wires bootstrap and delegates
  // to @claude-code/cli / @claude-code/app-host / @claude-code/config.
  const requiredMainSeams = [
    './runtime/bootstrap.js',
    '@claude-code/app-host',
    '@claude-code/config',
    '@claude-code/cli',
  ]
  for (const seam of requiredMainSeams) {
    if (!mainContent.includes(seam)) {
      throw new Error(`main.tsx does not consume required seam: ${seam}`)
    }
  }

  // V7 §10.1: tool-registry is consumed by the mode-dispatch action handler
  // extracted into @claude-code/cli; main.tsx itself no longer imports it.
  if (!modeDispatchContent.includes('@claude-code/tool-registry')) {
    throw new Error(
      'packages/cli/src/entry/mode-dispatch.ts does not consume required seam: @claude-code/tool-registry',
    )
  }

  const disallowedMainImports = [
    './services/packageHostSetup.js',
    'src/services/packageHostSetup.js',
    './services/api/providerHostSetup.js',
    'src/services/api/providerHostSetup.js',
  ]
  for (const disallowed of disallowedMainImports) {
    if (mainContent.includes(disallowed)) {
      throw new Error(`main.tsx still imports owner logic seam: ${disallowed}`)
    }
  }

  const disallowedInteractiveAssemblySeams = [
    'syncRuntimeHandlesFromAppState(',
    'sessionStoreFactory.createInteractiveStore',
  ]
  for (const disallowed of disallowedInteractiveAssemblySeams) {
    if (mainContent.includes(disallowed)) {
      throw new Error(
        `main.tsx still performs interactive session assembly: ${disallowed}`,
      )
    }
  }

  const disallowedHostOwnerImports = [
    "from '../services/api/providerHostSetup.js'",
    "from 'src/services/api/providerHostSetup.js'",
  ]
  for (const disallowed of disallowedHostOwnerImports) {
    if (replContent.includes(disallowed)) {
      throw new Error(`REPL.tsx still imports owner logic seam: ${disallowed}`)
    }
    if (printContent.includes(disallowed)) {
      throw new Error(`print.ts still imports owner logic seam: ${disallowed}`)
    }
  }

  const commandHost = getCommandRegistryHostBindings()
  if (typeof commandHost.getCommands !== 'function') {
    throw new Error('Command registry host binding is missing getCommands')
  }

  const mcpHost = getMcpRuntimeHostBindings()
  if (typeof mcpHost.getMcpToolsCommandsAndResources !== 'function') {
    throw new Error(
      'MCP runtime host binding is missing getMcpToolsCommandsAndResources',
    )
  }

  console.log('entry thin host verification passed')
}

await main()
