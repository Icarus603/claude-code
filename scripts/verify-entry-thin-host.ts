import { readFile } from 'fs/promises'
import { getCommandRegistryHostBindings } from '@claude-code/command-registry'
import { getMcpRuntimeHostBindings } from '@claude-code/mcp-runtime'
import '../src/runtime/bootstrap.js'
import '../src/commands.js'
import '../src/services/mcp/client.js'

async function main(): Promise<void> {
  const mainContent = await readFile('./src/main.tsx', 'utf8')

  const requiredEntrySeams = [
    './runtime/bootstrap.js',
    '@claude-code/app-host',
    '@claude-code/config',
    '@claude-code/cli',
    '@claude-code/tool-registry',
  ]
  for (const seam of requiredEntrySeams) {
    if (!mainContent.includes(seam)) {
      throw new Error(`main.tsx does not consume required seam: ${seam}`)
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
