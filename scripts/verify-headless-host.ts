import { readFile } from 'fs/promises'

async function main(): Promise<void> {
  const [mainContent, cliIndex, cliHeadless, printContent, cliBindings, modeDispatchContent] =
    await Promise.all([
      readFile('src/main.tsx', 'utf8'),
      readFile('packages/cli/src/index.ts', 'utf8'),
      readFile('packages/cli/src/headless.ts', 'utf8'),
      readFile('src/cli/print.ts', 'utf8'),
      readFile('src/runtime/installCliBindings.ts', 'utf8'),
      readFile('packages/cli/src/entry/mode-dispatch.ts', 'utf8'),
    ])
  // After cut-E, the action handler body lives in mode-dispatch.ts.
  const combinedMainContent = mainContent + modeDispatchContent

  const requiredMainSeams = [
    "createHeadlessHost",
    "import { createHeadlessSession } from '@claude-code/cli'",
    'const headlessHost = createHeadlessHost',
  ]

  for (const seam of requiredMainSeams) {
    if (!combinedMainContent.includes(seam)) {
      throw new Error(`main.tsx missing headless host seam: ${seam}`)
    }
  }

  if (mainContent.includes("from './cli/print.js'")) {
    throw new Error('main.tsx must not import src/cli/print.ts directly')
  }

  if (cliIndex.includes('launchRepl(')) {
    throw new Error('packages/cli should only own headless transport/session seams')
  }

  if (!cliHeadless.includes('getCliHostBindings()')) {
    throw new Error(
      'packages/cli/src/headless.ts must resolve root-installed CLI host bindings',
    )
  }

  if (!cliBindings.includes('installCliHostBindings({')) {
    throw new Error(
      'src/runtime/installCliBindings.ts must install root CLI headless bindings',
    )
  }

  if (cliBindings.includes('AppStateStore')) {
    throw new Error(
      'src/runtime/installCliBindings.ts must not import AppStateStore directly',
    )
  }

  if (!printContent.includes("import 'src/runtime/bootstrap.js'")) {
    throw new Error('src/cli/print.ts must load runtime bootstrap before headless flow')
  }

  console.log('headless host verification passed')
}

await main()
