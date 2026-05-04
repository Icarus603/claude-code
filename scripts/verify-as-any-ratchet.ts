#!/usr/bin/env bun
/**
 * verify-as-any-ratchet — `as any` cast count is a one-way-down ratchet.
 *
 * `as any` casts opt out of type-checking on the value's downstream uses.
 * Less dangerous than `as never` (which is bottom type, assignable to
 * anything without flag), but still erases the type system's value at
 * the cast site. This repo has 413 of them as of V9 series end (2026-05-04),
 * dominated by the V7 §7.2 host-binding `missingBinding('name') as any`
 * pattern in swarm/adapters/appRuntime.ts and a few sister files. That
 * pattern is a deliberate placeholder — runtime injects a real function
 * later — but it's still a place future code-readers cannot rely on the
 * type system. New casts MUST come with --tighten or a real reduction
 * elsewhere.
 *
 * Common (legitimate) uses in this repo:
 *   - V7 §7.2 host-binding placeholder: `let X = missingBinding('X') as any`
 *   - Cross-package boundary at provider adapters (openai/grok/gemini)
 *     where the SDK's typing is dynamic by design
 *   - Multi-line `missingBinding(\n  'name',\n) as any` (these get matched
 *     by the regex too — same intent)
 *
 * Common (illegitimate) uses:
 *   - Silencing a TS error during a refactor without understanding why
 *   - Bridging an `unknown` value to a domain type without runtime
 *     validation (`x as any as Foo`)
 *
 * Excludes: __tests__ (mocks legitimately use `as any`), .d.ts (no
 * runtime effect), .test.* files. We DO include host-binding
 * placeholders in the count — they're not bugs but they are real
 * type-system gaps and should not multiply silently.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const PACKAGES_DIR = join(REPO_ROOT, 'packages')
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'as-any-baseline.json')

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

const AS_ANY_RE = /\bas any\b/g

type Entry = { file: string; line: number; text: string }

function scanFile(filePath: string): Entry[] {
  const content = readFileSync(filePath, 'utf-8')
  const entries: Entry[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const matches = line.matchAll(AS_ANY_RE)
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
      `verify-as-any-ratchet: tightened baseline ${BASELINE.count} → ${allEntries.length}`,
    )
    return
  }

  if (allEntries.length > BASELINE.count) {
    console.error(
      `verify-as-any-ratchet: ${allEntries.length} "as any" casts (baseline ${BASELINE.count})`,
    )
    console.error('')
    console.error(
      `Found ${allEntries.length - BASELINE.count} new occurrence(s). "as any" opts out of`,
    )
    console.error(
      'type-checking on downstream uses. Either:',
    )
    console.error(
      '  1. Replace with a real type (import the canonical, write a guard, or',
    )
    console.error(
      '     re-export from the V7 §7.2 host-binding contract).',
    )
    console.error('  2. Reduce existing "as any" elsewhere to make room.')
    console.error(
      '  3. Run "bun scripts/verify-as-any-ratchet.ts --tighten" if the new',
    )
    console.error(
      '     usage is documented and unavoidable (host-binding placeholder).',
    )
    console.error('')

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
      `verify-as-any-ratchet: ${allEntries.length} (baseline ${BASELINE.count}) — ` +
        `${BASELINE.count - allEntries.length} fewer than baseline! Run --tighten to lock.`,
    )
    return
  }

  console.log(`verify-as-any-ratchet: ${allEntries.length} (locked)`)
}

await main()
