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
  const [main, print] = await Promise.all([
    readFile('src/main.tsx', 'utf8'),
    readFile('src/cli/print.ts', 'utf8'),
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

  if (violations.length > 0) {
    throw new Error(`Runtime boundary violations:\n${violations.join('\n')}`)
  }

  console.log('runtime boundary verification passed')
}

await main()
