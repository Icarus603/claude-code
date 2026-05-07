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

// Three forms count as static graph edges:
//   - `from '...'`              ESM static import/export
//   - `require('...')`          CJS sync require
// `import('...')` (dynamic ESM import) does NOT — it's a runtime
// boundary (V7 §3.2). Static analysis treating it as an edge would
// disqualify the very pattern V7 documents for breaking cycles.
const SPEC_RE = /(?:\bfrom\s+['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"])/g

// Strip JS comments before scanning for imports — without this, prose like
// "previously importing from '@claude-code/X'" inside `// ...` comments
// adds a false edge to the import graph and produces phantom cycles.
//
// Also strip TypeScript `import type { ... } from '...'` and
// `export type { ... } from '...'` lines — type-only imports are erased
// at compile time and cannot form a runtime cycle.
function stripComments(src: string): string {
  // V7 §3.2 lazy-require lines marked with the eslint disable directive
  // are intentional runtime-deferred dependencies. Strip the next line
  // BEFORE the comment-stripper runs so the require() call doesn't
  // contribute a static graph edge. (Both the eslint comment and the
  // require call get scrubbed from the input here, so the SCC sees them
  // as "no edge".)
  src = src.replace(
    /\/\/\s*eslint-disable-next-line[^\n]*no-require-imports[^\n]*\n[^\n]*/g,
    '',
  )
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // /* block */
    .replace(/(^|\s)\/\/[^\n]*/g, '$1') // // line
    // Multi-line type-only imports/exports — `[\s\S]*?` lets the pattern
    // span newlines so `import type {\n  Foo,\n} from '...'` is stripped
    // entirely instead of only the first line (which would leave the
    // `from '...'` clause as a phantom edge).
    .replace(/^\s*import\s+type\s[\s\S]*?from\s+['"][^'"]+['"][^\n]*/gm, '')
    .replace(/^\s*export\s+type\s[\s\S]*?from\s+['"][^'"]+['"][^\n]*/gm, '')
    // Single-line type forms without `from` (e.g. `export type X = ...`)
    .replace(/^\s*import\s+type\s[^\n]*/gm, '')
    .replace(/^\s*export\s+type\s[^\n]*/gm, '')
}

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
  const content = stripComments(await readFile(f, 'utf8'))
  let m: RegExpExecArray | null
  SPEC_RE.lastIndex = 0
  while ((m = SPEC_RE.exec(content))) {
    // m[1] = `from '...'` capture, m[2] = `require('...')` capture
    const spec = m[1] ?? m[2]
    if (!spec) continue
    const target = await resolveSpec(f, spec)
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

// Ratchet: count tightened from 44 → 20 after fixing detector false
// positives (comment-stripping + type-only-import filtering); then to
// 15 by extracting leaf modules; then to 9 after extracting more leaves
// AND fixing the multi-line type-import strip; then to 8 after
// shrinking same-package SCCs; then to 5 (2026-04-27 Ralph loop) by
// extracting messageStaticness, slowLoggingTag, formatSkillLoadingMetadata
// to leaves; redirecting provider→repl back-edges through canonicals;
// dropping the duplicate cli host-bindings registration. Then to 2 +
// then to 1 (2026-05-07 maintenance sweep) as the BG/fork session's
// daemon-side modules avoided introducing new cycles. Remaining 1 SCC
// is the 250-file cross-cutting mega (provider+agent+config+permission+
// tool-registry+repl+mcp-runtime). Breaking it requires sustained
// restructuring that's out of scope for the post-port maintenance
// sweep; locked at 1 so any regression introducing a separate cycle
// still fails the verifier.
const BUDGET = 1

// Diagnostic mode: print cycles to stdout when --list flag is passed
if (process.argv.includes('--list')) {
  for (const scc of sccs) {
    console.log(`cycle (${scc.length} files):`)
    for (const f of scc) console.log(`  ${f}`)
  }
  process.exit(0)
}

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
