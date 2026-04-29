#!/usr/bin/env bun
/**
 * verify-as-never-ratchet — `as never` cast count is a one-way-down ratchet.
 *
 * `as never` casts disable type checking entirely on the value. They are
 * MORE dangerous than `as any` because the resulting type is the bottom
 * type — TypeScript treats it as assignable to anything, hiding bugs that
 * `any` would have at least flagged at the consumption site.
 *
 * Common (legitimate) uses:
 *   - Branded-type construction: `value as Brand` where Brand is a never
 *     type-tag overlay
 *   - Host-binding shim wrappers passing through arbitrary args: `args as
 *     never[]`
 *   - Discriminated union exhaustiveness: `assertNever(x as never)`
 *
 * Common (illegitimate) uses:
 *   - Silencing a type error during a refactor without understanding why
 *   - Casting `unknown` through `as never as Foo` to bypass validation
 *
 * This verifier counts and locks the current baseline. New `as never`
 * usages MUST come with --tighten or by reducing usage elsewhere.
 *
 * Excludes: __tests__ (mocks legitimately use `as never`), .d.ts
 * (declaration files have no runtime effect), .test.* files.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const PACKAGES_DIR = join(REPO_ROOT, 'packages')
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'as-never-baseline.json')

const BASELINE = (() => {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as { count: number }
  } catch {
    return { count: 0 }
  }
})()

function findTsFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      if (
        entry === 'node_modules' ||
        entry === '__tests__' ||
        entry === 'dist' ||
        entry === 'vendor' ||
        entry.startsWith('.')
      )
        continue
      results.push(...findTsFiles(full))
    } else if (
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.endsWith('.d.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    ) {
      results.push(full)
    }
  }
  return results
}

// Match `as never` followed by word boundary (not part of `as never[]` etc?).
// Actually we DO want to count `as never` and `as never[]` and `as never as`.
// The pattern is `\bas never\b` — word boundary before `as`, word boundary
// after `never` (which excludes `as nevermore` but allows `as never[]`,
// `as never;`, `as never)` because `[` and `;` and `)` are non-word).
const AS_NEVER_RE = /\bas never\b/g

type Entry = { file: string; line: number; text: string }

function scanFile(filePath: string): Entry[] {
  const content = readFileSync(filePath, 'utf-8')
  const entries: Entry[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const matches = line.matchAll(AS_NEVER_RE)
    for (const _ of matches) {
      entries.push({ file: filePath, line: i + 1, text: line.trim() })
    }
  }
  return entries
}

async function main(): Promise<void> {
  const tsFiles = findTsFiles(PACKAGES_DIR)
  const allEntries: Entry[] = []
  for (const file of tsFiles) {
    allEntries.push(...scanFile(file))
  }

  const tighten = process.argv.includes('--tighten')
  if (tighten) {
    const fs = await import('node:fs/promises')
    await fs.writeFile(
      BASELINE_PATH,
      JSON.stringify({ count: allEntries.length }, null, 2) + '\n',
    )
    console.log(
      `verify-as-never-ratchet: tightened baseline ${BASELINE.count} → ${allEntries.length}`,
    )
    return
  }

  if (allEntries.length > BASELINE.count) {
    console.error(
      `verify-as-never-ratchet: ${allEntries.length} "as never" casts (baseline ${BASELINE.count})`,
    )
    console.error('')
    console.error(
      `Found ${allEntries.length - BASELINE.count} new occurrence(s). "as never" disables type`,
    )
    console.error(
      'checking entirely — bottom-type casts are MORE dangerous than `as any`',
    )
    console.error(
      'because the resulting value is assignable to anything without a runtime check.',
    )
    console.error('')
    console.error('Either:')
    console.error(
      '  1. Replace the cast with a proper type guard (instanceof / typeof / schema)',
    )
    console.error(
      '  2. Reduce existing "as never" usage elsewhere to make room',
    )
    console.error(
      '  3. Run "bun scripts/verify-as-never-ratchet.ts --tighten" if the new',
    )
    console.error(
      '     usage is documented and unavoidable (host-binding shim, branded type).',
    )
    console.error('')

    // Show top files for quick triage
    const byFile = new Map<string, number>()
    for (const e of allEntries) {
      byFile.set(e.file, (byFile.get(e.file) ?? 0) + 1)
    }
    const sorted = Array.from(byFile.entries()).sort((a, b) => b[1] - a[1])
    console.error('Top files:')
    for (const [file, count] of sorted.slice(0, 5)) {
      const rel = file.replace(REPO_ROOT + '/', '')
      console.error(`  ${count}× ${rel}`)
    }
    process.exit(1)
  }

  if (allEntries.length < BASELINE.count) {
    console.log(
      `verify-as-never-ratchet: ${allEntries.length} (baseline ${BASELINE.count}) — ` +
        `${BASELINE.count - allEntries.length} fewer than baseline! Run --tighten to lock.`,
    )
    return
  }

  console.log(`verify-as-never-ratchet: ${allEntries.length} (locked)`)
}

await main()
