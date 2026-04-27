import { readFile } from 'fs/promises'

async function main(): Promise<void> {
  const [mainContent, cliIndex, cliHeadless, printContent, cliBindings, modeDispatchContent] =
    await Promise.all([
      readFile('packages/cli/src/entry/main.tsx', 'utf8'),
      readFile('packages/cli/src/index.ts', 'utf8'),
      readFile('packages/cli/src/headless.ts', 'utf8'),
      readFile('packages/cli/src/print.ts', 'utf8'),
      readFile('packages/app-host/src/runtime/installCliBindings.ts', 'utf8'),
      readFile('packages/cli/src/entry/mode-dispatch.ts', 'utf8'),
    ])
  // After cut-E, the action handler body lives in mode-dispatch.ts.
  const combinedMainContent = mainContent + modeDispatchContent

  // Some seams have multiple acceptable shapes — string = exact match,
  // string[] = any-of (at least one substring must be present).
  const requiredMainSeams: (string | string[])[] = [
    'createHeadlessHost',
    // Accept either the public barrel path or the direct relative path —
    // the latter is preferred to keep cli's same-package SCC clean
    // (V7 §11.2). Both resolve to the same export.
    [
      "import { createHeadlessSession } from '@claude-code/cli'",
      "import { createHeadlessSession } from '../headless.js'",
    ],
    'const headlessHost = createHeadlessHost',
  ]

  for (const seam of requiredMainSeams) {
    const accepted = Array.isArray(seam) ? seam : [seam]
    if (!accepted.some(s => combinedMainContent.includes(s))) {
      throw new Error(`main.tsx missing headless host seam: ${accepted[0]}`)
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
      '@claude-code/app-host/runtime/installCliBindings.ts must install root CLI headless bindings',
    )
  }

  if (cliBindings.includes('AppStateStore')) {
    throw new Error(
      '@claude-code/app-host/runtime/installCliBindings.ts must not import AppStateStore directly',
    )
  }

  if (!printContent.includes("import '@claude-code/app-host/runtime/bootstrap.js'")) {
    throw new Error('packages/cli/src/print.ts must load runtime bootstrap before headless flow')
  }

  console.log('headless host verification passed')
}

await main()
