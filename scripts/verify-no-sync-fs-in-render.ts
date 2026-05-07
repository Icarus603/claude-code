#!/usr/bin/env bun
/**
 * verify-no-sync-fs-in-render — sync fs I/O inside React render-context
 * (.tsx files) is a one-way-down ratchet.
 *
 * Sync fs blocks the event loop. In a React render function it freezes
 * the terminal until disk I/O completes — fatal on slow disks (NFS,
 * spinning rust) or when reading large files.
 *
 * The codebase already has cases where sync fs is necessary (file-permission
 * diff dialogs that fire from inside a synchronous canUseTool flow). Those
 * are grandfathered. New occurrences fail unless --tighten + justification.
 *
 * Excludes: __tests__, .test.*, .d.ts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const PACKAGES_DIR = join(REPO_ROOT, 'packages')
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'sync-fs-render-baseline.json')

const BASELINE = (() => {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as { count: number }
  } catch {
    return { count: 0 }
  }
})()

function findTsxFiles(dir: string): string[] {
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
      results.push(...findTsxFiles(full))
    } else if (
      entry.endsWith('.tsx') &&
      !entry.endsWith('.test.tsx')
    ) {
      results.push(full)
    }
  }
  return results
}

// Sync fs primitives that block the event loop. Each maps to an async
// alternative (readFile, writeFile, stat, etc.).
const SYNC_FS_RE =
  /\b(readFileSync|writeFileSync|appendFileSync|statSync|lstatSync|existsSync|realpathSync|readlinkSync|readdirSync|readSync|fstatSync|mkdirSync|rmSync|unlinkSync|copyFileSync|chmodSync|symlinkSync)\b/g

type Entry = { file: string; line: number; method: string }

function scanFile(filePath: string): Entry[] {
  const content = readFileSync(filePath, 'utf-8')
  const entries: Entry[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    // Skip comment-only lines
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
    // Skip lines explicitly marked safe with the existing eslint-disable
    if (line.includes('eslint-disable') && line.includes('no-sync-fs')) continue
    const matches = line.matchAll(SYNC_FS_RE)
    for (const m of matches) {
      entries.push({ file: filePath, line: i + 1, method: m[1]! })
    }
  }
  return entries
}

async function main(): Promise<void> {
  const tsxFiles = findTsxFiles(PACKAGES_DIR)
  const allEntries: Entry[] = []
  for (const file of tsxFiles) {
    allEntries.push(...scanFile(file))
  }

  const tighten = process.argv.includes('--tighten')
  if (tighten) {
    // One-way down: never raise the baseline. See verify-as-any-ratchet.ts
    // for rationale; meta-check in verify-tighten-monotonic.ts.
    const next = Math.min(allEntries.length, BASELINE.count)
    const fs = await import('node:fs/promises')
    await fs.writeFile(
      BASELINE_PATH,
      JSON.stringify({ count: next }, null, 2) + '\n',
    )
    console.log(
      `verify-no-sync-fs-in-render: tightened baseline ${BASELINE.count} → ${next}`,
    )
    return
  }

  if (allEntries.length > BASELINE.count) {
    console.error(
      `verify-no-sync-fs-in-render: ${allEntries.length} sync-fs calls in .tsx (baseline ${BASELINE.count})`,
    )
    console.error('')
    console.error(
      `Found ${allEntries.length - BASELINE.count} new occurrence(s).`,
    )
    console.error('')
    console.error('Sync fs in React render functions blocks the event loop and')
    console.error('freezes the terminal. Use the async alternative instead:')
    console.error('  readFileSync  → readFile (fs/promises)')
    console.error('  writeFileSync → writeFile')
    console.error('  statSync      → stat')
    console.error('  existsSync    → access (with try/catch)')
    console.error('')
    console.error('Or wrap in useEffect / useMemo with proper async handling.')
    console.error('')
    console.error(
      'If the sync fs is required (e.g., FilePermissionDialog reads diff for',
    )
    console.error(
      'rendered preview), add `// eslint-disable-next-line custom-rules/no-sync-fs -- <reason>`',
    )
    console.error('and run `bun scripts/verify-no-sync-fs-in-render.ts --tighten`.')

    const byFile = new Map<string, number>()
    for (const e of allEntries) {
      byFile.set(e.file, (byFile.get(e.file) ?? 0) + 1)
    }
    const sorted = Array.from(byFile.entries()).sort((a, b) => b[1] - a[1])
    console.error('')
    console.error('Top files:')
    for (const [file, count] of sorted.slice(0, 5)) {
      const rel = relative(REPO_ROOT, file)
      console.error(`  ${count}× ${rel}`)
    }
    process.exit(1)
  }

  if (allEntries.length < BASELINE.count) {
    console.log(
      `verify-no-sync-fs-in-render: ${allEntries.length} (baseline ${BASELINE.count}) — ` +
        `${BASELINE.count - allEntries.length} fewer than baseline. Run --tighten to lock.`,
    )
    return
  }

  console.log(
    `verify-no-sync-fs-in-render: ${allEntries.length} (locked)`,
  )
}

await main()
