import { readFile } from 'fs/promises'

const REPL_LINE_BUDGET = 120

async function main(): Promise<void> {
  const [replLauncher, replContent, cliIndex, modeDispatchContent] = await Promise.all([
    readFile('src/replLauncher.tsx', 'utf8'),
    readFile('src/screens/REPL.tsx', 'utf8'),
    readFile('packages/cli/src/index.ts', 'utf8'),
    readFile('packages/cli/src/entry/mode-dispatch.ts', 'utf8'),
  ])

  // V7 §10.1: the REPL launch action moved to
  // packages/cli/src/entry/mode-dispatch.ts, so the dedicated launcher seam
  // must be consumed there — not from main.tsx.
  if (!modeDispatchContent.includes("from '../../../../src/replLauncher.js'")) {
    throw new Error(
      'packages/cli/src/entry/mode-dispatch.ts no longer consumes the dedicated repl launcher seam',
    )
  }

  if (cliIndex.includes('launchRepl(')) {
    throw new Error('packages/cli public surface should not call launchRepl directly')
  }

  const disallowedReplImports = [
    "../services/api/providerHostSetup.js",
    "src/services/api/providerHostSetup.js",
    "../services/packageHostSetup.js",
    "src/services/packageHostSetup.js",
  ]

  for (const pattern of disallowedReplImports) {
    if (replContent.includes(pattern)) {
      throw new Error(`REPL.tsx still imports owner seam "${pattern}"`)
    }
  }

  if (!replLauncher.includes("const { REPL } = await import('./screens/REPL.js')")) {
    throw new Error('replLauncher.tsx no longer lazily composes the REPL screen')
  }

  const requiredReplSeams = [
    "./REPLView.js",
    "./repl/REPLController.js",
  ]
  for (const seam of requiredReplSeams) {
    if (!replContent.includes(seam)) {
      throw new Error(`REPL.tsx missing thin-entry seam "${seam}"`)
    }
  }

  const disallowedThinEntryImports = [
    '../services/',
    '../components/',
    '../hooks/',
    '../utils/',
    '../Tool.js',
    '../commands.js',
  ]
  for (const pattern of disallowedThinEntryImports) {
    if (replContent.includes(pattern)) {
      throw new Error(`REPL.tsx thin entry regressed with import "${pattern}"`)
    }
  }

  const lineCount = replContent.split('\n').length
  if (lineCount > REPL_LINE_BUDGET) {
    throw new Error(
      `REPL.tsx grew beyond ratchet budget: current=${lineCount}, budget=${REPL_LINE_BUDGET}`,
    )
  }

  console.log('repl owner verification passed')
}

await main()
