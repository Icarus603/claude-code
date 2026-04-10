import { readFile } from 'fs/promises'

const APP_STATE_LINE_BUDGET = 40

async function main(): Promise<void> {
  const content = await readFile('src/state/AppStateStore.ts', 'utf8')

  const disallowedPatterns = [
    '../query.js',
    '../QueryEngine.js',
    '../cli/print.js',
    '../services/api/providerHostSetup.js',
    '../services/mcp/client.js',
    'toolPermissionContext',
    'agentDefinitions',
    'plugins:',
    'mcp:',
  ]

  for (const pattern of disallowedPatterns) {
    if (content.includes(pattern)) {
      throw new Error(
        `AppStateStore owner boundary regression: found forbidden import "${pattern}"`,
      )
    }
  }

  const lineCount = content.split('\n').length
  if (lineCount > APP_STATE_LINE_BUDGET) {
    throw new Error(
      `AppStateStore grew beyond ratchet budget: current=${lineCount}, budget=${APP_STATE_LINE_BUDGET}`,
    )
  }

  console.log('app state boundary verification passed')
}

await main()
