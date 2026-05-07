#!/usr/bin/env bun
/**
 * verify-cross-package-coupling — count distinct sibling packages each
 * package imports from. Locks the current numbers as a ratchet so future
 * changes can reduce coupling but never silently grow it.
 *
 * "Coupling" here = number of unique \`@claude-code/<other>\` package names
 * referenced from anywhere inside packages/<self>/. Reaching for one symbol
 * vs ten symbols from the same package counts the same — what matters is
 * how many distinct boundaries each package crosses.
 *
 * V7 §3.2 / §8 — packages should compose narrowly. New dependencies need
 * deliberate review (and a ratchet bump).
 */

import { readFile } from 'fs/promises'
import { Glob } from 'bun'

const IMPORT_RE = /(?:from|import|require)\s*\(?\s*['"]@claude-code\/([a-z@][a-z0-9@/-]*)/g

// Tight ratchet — set to current actuals. Future PRs can only reduce.
const BUDGET: Record<string, number> = {
  'agent': 19,
  'app-host': 21,
  'bridge': 14,
  'cli': 22,  // +1: src/{main,entrypoints/cli,entrypoints/mcp} moved into packages/cli/src/entry/, all their imports now count as cli's deps
  'command-runtime': 20,
  'config': 14,  // +1: mcp-runtime lazy-required by plugin/_deps to fix MCP schema null bug
  'daemon': 6, // bg classifier (agent/provider/tool-registry/local-observability) + spare claim (cli/ptyFrame)
  'headless-sdk': 2,
  'ide': 10,
  'local-observability': 13,
  'mcp-runtime': 13,
  'memory': 5,
  'output': 7,
  'permission': 15,
  'provider': 16,
  'repl': 22,
  'server': 8,
  'shell': 11,
  'storage': 15,
  'swarm': 13,
  'teleport': 9,
  'tool-registry': 19,
  'updater': 6,
  'voice': 7,
}

const SCOPED = ['@ant'] as const

async function countCouplings(pkgDir: string, selfName: string): Promise<Set<string>> {
  const deps = new Set<string>()
  for await (const file of new Glob(`${pkgDir}/**/*.{ts,tsx}`).scan('.')) {
    if (file.includes('node_modules/')) continue
    const content = await readFile(file, 'utf8')
    let m: RegExpExecArray | null
    IMPORT_RE.lastIndex = 0
    while ((m = IMPORT_RE.exec(content))) {
      // m[1] is everything after @claude-code/ up to the first whitespace/quote
      // Strip the subpath and pull just the package name (handle scoped names)
      const raw = m[1]
      let name: string
      if (raw.startsWith('@')) {
        // @scope/name/sub → @scope/name
        const parts = raw.split('/')
        name = parts.slice(0, 2).join('/')
      } else {
        name = raw.split('/')[0]!
      }
      if (name !== selfName && name !== `@claude-code/${selfName}`) deps.add(name)
    }
  }
  return deps
}

let failed = false
const results: { pkg: string; current: number; budget: number }[] = []

for (const pkg of Object.keys(BUDGET)) {
  const deps = await countCouplings(`packages/${pkg}`, pkg)
  const current = deps.size
  results.push({ pkg, current, budget: BUDGET[pkg]! })
  if (current > BUDGET[pkg]!) {
    console.error(
      `✗ ${pkg}: coupling grew to ${current} (budget ${BUDGET[pkg]}). New deps: ${[...deps].sort().join(', ')}`,
    )
    failed = true
  }
}

if (failed) {
  console.error(
    '\nReduce the new dependency, OR justify and update the budget in scripts/verify-cross-package-coupling.ts.',
  )
  process.exit(1)
}

const total = results.reduce((s, r) => s + r.current, 0)
const budgetTotal = results.reduce((s, r) => s + r.budget, 0)
console.log(`cross-package-coupling: ${total}/${budgetTotal} edges (${results.length} packages)`)
