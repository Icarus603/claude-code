#!/usr/bin/env bun
/**
 * verify-no-cycles — packages/ must contain no cyclic import chains.
 *
 * Past V7 sessions hit `debug ↔ slowOperations` style cycles that corrupted
 * module loading silently — the import graph appeared fine until a specific
 * runtime path triggered partial-init failure (one side saw the other as
 * undefined). This static check builds the directed graph from every
 * `from '...'` / `import('...')` / `require('...')` in packages/ and runs
 * Tarjan's SCC to flag any non-trivial cycle.
 *
 * V7 §11.2. Restricted to packages/<X>/file → packages/<Y>/file edges
 * (cross-package). Same-package cycles inside src/ are out of scope here
 * — that's package-internal layout, not architectural concern.
 */

import { Glob } from 'bun'
import { readFile } from 'fs/promises'
import { dirname, relative, resolve } from 'path'

const repoRoot = resolve('.')

// Map: file → set of files it imports (resolved to .ts/.tsx)
const graph = new Map<string, Set<string>>()
const allFiles = new Set<string>()

const SPEC_RE = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g

for await (const f of new Glob('packages/**/*.{ts,tsx}').scan('.')) {
  if (f.includes('node_modules/') || f.includes('__tests__/') || f.endsWith('.test.ts') || f.endsWith('.test.tsx')) continue
  allFiles.add(f)
}

async function resolveSpec(fromFile: string, spec: string): Promise<string | null> {
  if (spec.startsWith('.')) {
    const base = resolve(dirname(fromFile), spec.replace(/\.js$/, ''))
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      const cand = relative(repoRoot, base + ext)
      if (allFiles.has(cand)) return cand
    }
    return null
  }
  if (spec.startsWith('@claude-code/')) {
    // Crude resolution: find the package, then look up package.json exports
    const stripped = spec.replace(/^@claude-code\//, '')
    const slash = stripped.indexOf('/')
    const pkgName = slash === -1 ? stripped : stripped.slice(0, slash)
    const subpath = slash === -1 ? '.' : './' + stripped.slice(slash + 1)
    try {
      const pkgJson = JSON.parse(await readFile(`packages/${pkgName}/package.json`, 'utf8'))
      const exportsMap = pkgJson.exports ?? {}
      let target: string | undefined = exportsMap[subpath]
      if (!target) {
        // try with/without .js
        const alt = subpath.endsWith('.js') ? subpath.replace(/\.js$/, '') : subpath + '.js'
        target = exportsMap[alt]
      }
      if (typeof target === 'string') {
        const cand = `packages/${pkgName}/${target.replace(/^\.\//, '')}`
        if (allFiles.has(cand)) return cand
      }
    } catch {}
    return null
  }
  return null
}

for (const f of allFiles) {
  graph.set(f, new Set())
  const content = await readFile(f, 'utf8')
  let m: RegExpExecArray | null
  SPEC_RE.lastIndex = 0
  while ((m = SPEC_RE.exec(content))) {
    const target = await resolveSpec(f, m[1])
    if (target && target !== f) graph.get(f)!.add(target)
  }
}

// Tarjan's SCC
let index = 0
const indices = new Map<string, number>()
const lowlinks = new Map<string, number>()
const onStack = new Set<string>()
const stack: string[] = []
const sccs: string[][] = []

function strongconnect(v: string) {
  indices.set(v, index)
  lowlinks.set(v, index)
  index++
  stack.push(v)
  onStack.add(v)

  for (const w of graph.get(v) ?? []) {
    if (!indices.has(w)) {
      strongconnect(w)
      lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!))
    } else if (onStack.has(w)) {
      lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!))
    }
  }

  if (lowlinks.get(v) === indices.get(v)) {
    const component: string[] = []
    let w: string
    do {
      w = stack.pop()!
      onStack.delete(w)
      component.push(w)
    } while (w !== v)
    if (component.length > 1) sccs.push(component)
  }
}

for (const v of graph.keys()) {
  if (!indices.has(v)) strongconnect(v)
}

// Ratchet: 44 known cycles in decompiled code. Lock the count so any
// new cycle introduced by a refactor will fail; existing ones are
// tracked for incremental cleanup (#92 successor work).
const BUDGET = 44

if (sccs.length > BUDGET) {
  console.error(`✗ no-cycles: ${sccs.length} cycles (budget ${BUDGET}). New cycle(s) introduced:`)
  for (const scc of sccs.slice(0, 5)) {
    console.error(`  cycle (${scc.length} files):`)
    for (const f of scc) console.error(`    ${f}`)
  }
  if (sccs.length > 5) console.error(`  ... and ${sccs.length - 5} more`)
  console.error(
    '\nBreak the cycle: extract the shared concept to a third module, ' +
    'or invert one direction (caller passes the dep instead of importing).',
  )
  process.exit(1)
}
console.log(`no-cycles: ${sccs.length} cycles (budget ${BUDGET}, ${allFiles.size} files)`)
