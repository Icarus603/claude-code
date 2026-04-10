import {
  getMcpRuntimeHostBindings,
  getMcpToolsCommandsAndResources,
  prefetchAllMcpResources,
} from '@claude-code/mcp-runtime'
import '../src/services/mcp/runtimeHostSetup.js'

async function main(): Promise<void> {
  const host = getMcpRuntimeHostBindings()
  if (
    typeof host.getMcpToolsCommandsAndResources !== 'function' ||
    typeof host.prefetchAllMcpResources !== 'function'
  ) {
    throw new Error('MCP runtime host bindings are incomplete')
  }

  let callbackCount = 0
  await getMcpToolsCommandsAndResources(() => {
    callbackCount += 1
  }, {})
  if (callbackCount !== 0) {
    throw new Error(
      `Expected zero callback invocations for empty MCP config, received ${callbackCount}`,
    )
  }

  const prefetchResult = await prefetchAllMcpResources({})
  if (
    prefetchResult.clients.length !== 0 ||
    prefetchResult.tools.length !== 0 ||
    prefetchResult.commands.length !== 0
  ) {
    throw new Error('Expected empty MCP prefetch result for empty config')
  }

  console.log('mcp runtime verification passed')
}

await main()
