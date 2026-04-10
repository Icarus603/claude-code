import { readFile } from 'fs/promises'

const PACKAGE_PATHS = [
  'packages/agent',
  'packages/provider',
  'packages/config',
  'packages/permission',
  'packages/memory',
  'packages/cli',
  'packages/tool-registry',
  'packages/command-registry',
  'packages/mcp-runtime',
  'packages/app-host/src',
  'packages/storage/src',
  'packages/output/src',
  'packages/local-observability/src',
]

const DISALLOWED_PATTERNS = [
  '@cc-app/',
  "from 'src/",
  'from "src/',
  "from '../src/",
  'from "../src/',
]

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
      exportLine: "export * from '@claude-code/command-registry/runtime'",
    },
    {
      path: 'src/services/mcp/client.ts',
      exportLine: "export * from '@claude-code/mcp-runtime/client'",
    },
    {
      path: 'src/services/api/claudeLegacy.ts',
      exportLine: "export * from '@claude-code/provider/claudeLegacy'",
    },
    {
      path: 'src/services/api/providerHostSetup.ts',
      exportLine: "export * from '@claude-code/provider/providerHostSetup'",
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

  return violations
}

async function main(): Promise<void> {
  const violations: string[] = []

  for (const root of PACKAGE_PATHS) {
    const files = await collectFiles(root)
    for (const filePath of files) {
      const content = await readFile(filePath, 'utf8')
      for (const pattern of DISALLOWED_PATTERNS) {
        if (content.includes(pattern)) {
          violations.push(`${filePath}: contains disallowed pattern "${pattern}"`)
        }
      }
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
