#!/usr/bin/env bun
/**
 * verify-console-log-leak — locks the count of raw `console.*` calls.
 *
 * Production bundle CANNOT contain raw `console.log/warn/error/debug/info`
 * outside the allowlist. They:
 *   - pollute SDK consumer stdout (--output-format=stream-json breaks)
 *   - leak debug data to users
 *   - bypass the structured logging path (logForDebugging, logError)
 *
 * `streamJsonStdoutGuard` exists ONLY because raw console.log slips through.
 * This ratchet prevents NEW slips.
 *
 * Allowlist: top-level CLI handlers + setup intentionally print to stdout
 * for UX (user-visible install messages, error reports, --help banners).
 *
 * Excludes: __tests__, .test.*, .d.ts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const PACKAGES_DIR = join(REPO_ROOT, 'packages')
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'console-log-baseline.json')

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

// Match `console.log(`, `console.warn(`, `console.error(`, etc.
// Word boundaries on both sides to avoid matching things like `myConsole.log`.
const CONSOLE_RE = /\bconsole\.(log|warn|error|debug|info)\b/g

type Entry = { file: string; line: number; method: string }

function scanFile(filePath: string): Entry[] {
  const content = readFileSync(filePath, 'utf-8')
  const entries: Entry[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    // Skip comment-only lines (single-line) — they're documentation, not calls.
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
    const matches = line.matchAll(CONSOLE_RE)
    for (const m of matches) {
      entries.push({ file: filePath, line: i + 1, method: m[1]! })
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
    // One-way down: never raise the baseline. See verify-as-any-ratchet.ts
    // for rationale; meta-check in verify-tighten-monotonic.ts.
    const next = Math.min(allEntries.length, BASELINE.count)
    const fs = await import('node:fs/promises')
    await fs.writeFile(
      BASELINE_PATH,
      JSON.stringify({ count: next }, null, 2) + '\n',
    )
    console.log(
      `verify-console-log-leak: tightened baseline ${BASELINE.count} → ${next}`,
    )
    return
  }

  if (allEntries.length > BASELINE.count) {
    console.error(
      `verify-console-log-leak: ${allEntries.length} console.* calls (baseline ${BASELINE.count})`,
    )
    console.error('')
    console.error(
      `Found ${allEntries.length - BASELINE.count} new occurrence(s). Raw console.*`,
    )
    console.error(
      'calls bypass structured logging and pollute SDK stdout streams.',
    )
    console.error('')
    console.error('Use one of:')
    console.error(
      '  - logForDebugging(msg, { level }) — for debug/info/warn/error messages',
    )
    console.error(
      '  - logError(error)               — for caught errors',
    )
    console.error(
      '  - process.stdout.write / stderr.write — for explicit user-facing UX,',
    )
    console.error(
      '    but only in CLI handlers / setup paths',
    )
    console.error('')
    console.error(
      'If the new console.* IS justified UX in a CLI/setup path, run',
    )
    console.error(
      '`bun scripts/verify-console-log-leak.ts --tighten` and commit the new baseline.',
    )
    console.error('')

    // Show top NEW files
    const byFile = new Map<string, number>()
    for (const e of allEntries) {
      byFile.set(e.file, (byFile.get(e.file) ?? 0) + 1)
    }
    const sorted = Array.from(byFile.entries()).sort((a, b) => b[1] - a[1])
    console.error('Top files:')
    for (const [file, count] of sorted.slice(0, 5)) {
      const rel = relative(REPO_ROOT, file)
      console.error(`  ${count}× ${rel}`)
    }
    process.exit(1)
  }

  if (allEntries.length < BASELINE.count) {
    console.log(
      `verify-console-log-leak: ${allEntries.length} (baseline ${BASELINE.count}) — ` +
        `${BASELINE.count - allEntries.length} fewer than baseline. Run --tighten to lock.`,
    )
    return
  }

  console.log(`verify-console-log-leak: ${allEntries.length} (locked)`)
}

await main()
