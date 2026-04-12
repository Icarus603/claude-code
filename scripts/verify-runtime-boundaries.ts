import { readFile } from 'fs/promises'

const PACKAGE_PATHS = [
  'packages/agent',
  'packages/provider',
  'packages/config',
  'packages/permission',
  'packages/memory',
  'packages/cli',
  'packages/tool-registry',
  'packages/command-runtime',
  'packages/mcp-runtime',
  'packages/app-host/src',
  'packages/storage/src',
  'packages/output/src',
  'packages/local-observability/src',
  'packages/swarm',
  'packages/ide/src',
  'packages/teleport/src',
  'packages/updater/src',
  'packages/server/src',
]

const DISALLOWED_PATTERNS = [
  '@cc-app/',
  "from 'src/",
  'from "src/',
  "from '../src/",
  'from "../src/',
]

const STRICT_PACKAGE_PATHS = new Set([
  'packages/app-host/src',
  'packages/storage/src',
  'packages/output/src',
  'packages/local-observability/src',
  'packages/shell',
  'packages/swarm',
  'packages/ide/src',
  'packages/teleport/src',
  'packages/updater/src',
  'packages/server/src',
])

const STRICT_DISALLOWED_PATTERNS = [...DISALLOWED_PATTERNS, '@claude-code/app-compat/']

const TRANSITION_APP_COMPAT_REF_BUDGET: Record<string, number> = {
  'packages/agent': 158,
  'packages/provider': 0,
  'packages/config': 43,
  // permission: +3 from repairing broken `typeof import('./autoModeState.js')`
  // references that ts couldn't resolve (verify-package-tsc-clean caught them)
  'packages/permission': 92,
  // memory: +2 for the same reason (findRelevantMemories + autoDream)
  'packages/memory': 85,
  'packages/cli': 0,
  'packages/tool-registry': 0,
  'packages/command-runtime': 0,
  'packages/mcp-runtime': 0,
}

async function collectFiles(root: string): Promise<string[]> {
  const proc = Bun.spawn([
    'find',
    root,
    '-type',
    'f',
    '(',
    '-name',
    '*.ts',
    '-o',
    '-name',
    '*.tsx',
    '-o',
    '-name',
    '*.js',
    ')',
    '-not',
    '-path',
    '*/node_modules/*',
  ], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = await new Response(proc.stdout).text()
  return out
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

async function verifyEntryBootstrapSeams(): Promise<string[]> {
  const violations: string[] = []
  const [main, print, bootstrap] = await Promise.all([
    readFile('src/main.tsx', 'utf8'),
    readFile('src/cli/print.ts', 'utf8'),
    readFile('src/runtime/bootstrap.ts', 'utf8'),
  ])

  if (!main.includes("./runtime/bootstrap.js")) {
    violations.push(
      'src/main.tsx: missing runtime skeleton bootstrap seam import',
    )
  }
  if (!print.includes("src/runtime/bootstrap.js")) {
    violations.push(
      'src/cli/print.ts: missing runtime skeleton bootstrap seam import',
    )
  }

  const disallowedEntryPatterns = [
    './services/packageHostSetup.js',
    'src/services/packageHostSetup.js',
    './tools.js',
    'src/tools.js',
  ]
  for (const pattern of disallowedEntryPatterns) {
    if (main.includes(pattern)) {
      violations.push(
        `src/main.tsx: still contains deprecated bootstrap import "${pattern}"`,
      )
    }
    if (print.includes(pattern)) {
      violations.push(
        `src/cli/print.ts: still contains deprecated bootstrap import "${pattern}"`,
      )
    }
  }

  const disallowedBootstrapPatterns = [
    '../commands.js',
    '../tools.js',
    '../services/mcp/client.js',
    '../services/api/providerHostSetup.js',
  ]
  for (const pattern of disallowedBootstrapPatterns) {
    if (bootstrap.includes(pattern)) {
      violations.push(
        `src/runtime/bootstrap.ts: still contains deprecated bootstrap import "${pattern}"`,
      )
    }
  }

  return violations
}

async function verifyRootFacadesStayThin(): Promise<string[]> {
  const violations: string[] = []

  const facadeFiles = [
    { path: 'src/tools.ts', exportLine: "export * from '@claude-code/tool-registry/runtime'" },
    {
      path: 'src/commands.ts',
      exportLine: "export * from '@claude-code/command-runtime/runtime'",
    },
    {
      path: 'src/services/mcp/client.ts',
      exportLine: "export * from './clientRuntime.js'",
    },
    {
      path: 'src/services/api/claudeLegacy.ts',
      exportLine: "export * from '@claude-code/provider/claudeLegacy'",
    },
  ]

  for (const facade of facadeFiles) {
    const raw = await readFile(facade.path, 'utf8')
    const normalized = raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .join('\n')

    if (normalized !== facade.exportLine) {
      violations.push(
        `${facade.path}: root facade must stay pure re-export (${facade.exportLine})`,
      )
    }
  }

  const providerHostSetupRaw = await readFile(
    'src/services/api/providerHostSetup.ts',
    'utf8',
  )
  if (!providerHostSetupRaw.includes('installProviderRuntimeBindings(bindings)')) {
    violations.push(
      'src/services/api/providerHostSetup.ts: provider host bindings must be installed from root composition seam',
    )
  }

  return violations
}

async function main(): Promise<void> {
  const violations: string[] = []
  const appCompatRefCountByPackage: Record<string, number> = {}

  for (const root of PACKAGE_PATHS) {
    const files = await collectFiles(root)
    for (const filePath of files) {
      const content = await readFile(filePath, 'utf8')
      const disallowedPatterns = STRICT_PACKAGE_PATHS.has(root)
        ? STRICT_DISALLOWED_PATTERNS
        : DISALLOWED_PATTERNS

      for (const pattern of disallowedPatterns) {
        if (content.includes(pattern)) {
          violations.push(`${filePath}: contains disallowed pattern "${pattern}"`)
        }
      }

      if (root in TRANSITION_APP_COMPAT_REF_BUDGET) {
        const refCount = (content.match(/@claude-code\/app-compat\//g) ?? [])
          .length
        appCompatRefCountByPackage[root] =
          (appCompatRefCountByPackage[root] ?? 0) + refCount
      }
    }
  }

  for (const [root, budget] of Object.entries(TRANSITION_APP_COMPAT_REF_BUDGET)) {
    const current = appCompatRefCountByPackage[root] ?? 0
    if (current > budget) {
      violations.push(
        `${root}: @claude-code/app-compat refs budget exceeded (current=${current}, budget=${budget})`,
      )
    }
  }

  violations.push(...(await verifyEntryBootstrapSeams()))
  violations.push(...(await verifyRootFacadesStayThin()))

  if (violations.length > 0) {
    throw new Error(`Runtime boundary violations:\n${violations.join('\n')}`)
  }

  console.log('runtime boundary verification passed')
}

await main()
