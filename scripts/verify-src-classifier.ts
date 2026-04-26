#!/usr/bin/env bun
/**
 * verify-src-classifier — locks the src/ classification breakdown so
 * each category can shrink but not grow without explicit budget bump.
 *
 * Categories:
 *   - entrypoint: cli.tsx / main.tsx / init.ts (always exactly 3)
 *   - facade: V7 §10.3 setter-callback wirers (caps via facade-budget)
 *   - shim: forward re-exports ≤8 LOC pointing into packages/
 *   - generated: protobuf output (kept stable)
 *   - test: should be 0 — tests live in tests/ or packages/__tests__/
 *   - other: real impl that should move to a package — must shrink
 *
 * Together with verify-src-shrinks (total LOC) and verify-facade-budget
 * (facade count), this gives per-class regression detection: a new
 * "other" file must consciously bump the budget instead of slipping
 * past a single aggregate ratchet.
 */

import { Glob } from 'bun'
import { readFile } from 'fs/promises'

const ENTRYPOINTS = new Set([
  'src/entrypoints/cli.tsx',
  'src/entrypoints/init.ts',
  'src/entrypoints/mcp.ts',
  'src/entrypoints/headlessSdkBootstrap.ts',
  'src/main.tsx',
])

type Class = 'entrypoint' | 'facade' | 'shim' | 'test' | 'generated' | 'other'

const counts: Record<Class, number> = {
  entrypoint: 0,
  facade: 0,
  shim: 0,
  test: 0,
  generated: 0,
  other: 0,
}

for await (const f of new Glob('src/**/*.{ts,tsx}').scan('.')) {
  let kind: Class = 'other'
  if (ENTRYPOINTS.has(f)) {
    kind = 'entrypoint'
  } else if (
    f.includes('__tests__/') ||
    f.endsWith('.test.ts') ||
    f.endsWith('.test.tsx')
  ) {
    kind = 'test'
  } else if (f.startsWith('src/types/generated/')) {
    kind = 'generated'
  } else {
    const c = await readFile(f, 'utf8')
    if (/§10\.3/.test(c) || /V7-EXEMPT/.test(c)) {
      kind = 'facade'
    } else if (
      c.split('\n').length <= 8 &&
      /^(export \*|export \{[^}]*\}) from/m.test(c)
    ) {
      kind = 'shim'
    }
  }
  counts[kind]++
}

// Ratchet: each category may shrink, not grow. Update budgets when work
// closes (e.g., #100 moved 2 task impls — "other" went from 38 to 36).
const BUDGETS: Record<Class, number> = {
  entrypoint: 3,
  facade: 35,
  shim: 470,
  test: 0,
  generated: 4,
  other: 30,
}

const violations: string[] = []
for (const k of Object.keys(BUDGETS) as Class[]) {
  if (counts[k] > BUDGETS[k]) {
    violations.push(
      `${k}: ${counts[k]} > budget ${BUDGETS[k]} (+${counts[k] - BUDGETS[k]})`,
    )
  }
}

if (violations.length > 0) {
  console.error('✗ src-classifier: per-class budgets exceeded:')
  for (const v of violations) console.error(`  ${v}`)
  console.error(
    '\nReduce the offending class, OR update BUDGETS in scripts/verify-src-classifier.ts.',
  )
  process.exit(1)
}

const total = Object.values(counts).reduce((s, n) => s + n, 0)
console.log(
  `src-classifier: ${total} files (` +
    Object.entries(counts)
      .map(([k, n]) => `${k}=${n}`)
      .join(', ') +
    ')',
)
