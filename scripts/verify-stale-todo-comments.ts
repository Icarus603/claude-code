#!/usr/bin/env bun
/**
 * verify-stale-todo-comments — TODO/FIXME/XXX/HACK comment count is a
 * one-way-down ratchet.
 *
 * TODOs without owners or follow-up tickets accumulate quietly. They mark
 * known issues but no ratchet locks the count, so they grow forever and
 * eventually become noise nobody reads.
 *
 * This ratchet locks the current count. New TODOs MUST come with --tighten
 * AND a documented justification (issue link, deadline, owner) — or
 * resolve the issue and don't add the TODO at all.
 *
 * Excludes: __tests__, .test.*, .d.ts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const PACKAGES_DIR = join(REPO_ROOT, 'packages')
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'todo-baseline.json')

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

// Match TODO / FIXME / XXX / HACK as standalone words. Only inside comments —
// match `//.*\b(TODO|...)\b` or `\*.*\b(TODO|...)\b` (block comments).
const TODO_RE = /(?:\/\/|\*).*\b(TODO|FIXME|XXX|HACK)\b/g

type Entry = { file: string; line: number; tag: string; text: string }

function scanFile(filePath: string): Entry[] {
  const content = readFileSync(filePath, 'utf-8')
  const entries: Entry[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const matches = line.matchAll(TODO_RE)
    for (const m of matches) {
      entries.push({
        file: filePath,
        line: i + 1,
        tag: m[1]!,
        text: line.trim(),
      })
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
      `verify-stale-todo-comments: tightened baseline ${BASELINE.count} → ${next}`,
    )
    return
  }

  if (allEntries.length > BASELINE.count) {
    console.error(
      `verify-stale-todo-comments: ${allEntries.length} TODO/FIXME/XXX/HACK comments (baseline ${BASELINE.count})`,
    )
    console.error('')
    console.error(
      `Found ${allEntries.length - BASELINE.count} new occurrence(s).`,
    )
    console.error('')
    console.error('Linus rule: TODO comments without owners accumulate forever and')
    console.error('become noise nobody reads. New TODOs require either:')
    console.error('  1. Resolve the issue NOW and skip the TODO entirely')
    console.error(
      '  2. Open a tracking issue, link it in the comment, and run',
    )
    console.error(
      '     `bun scripts/verify-stale-todo-comments.ts --tighten`',
    )
    console.error('')

    // Show top files
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
      `verify-stale-todo-comments: ${allEntries.length} (baseline ${BASELINE.count}) — ` +
        `${BASELINE.count - allEntries.length} fewer than baseline. Run --tighten to lock.`,
    )
    return
  }

  console.log(
    `verify-stale-todo-comments: ${allEntries.length} (locked)`,
  )
}

await main()
