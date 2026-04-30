#!/usr/bin/env bun
/**
 * verify-task-blocks-internal-only — Task.blocks is the internal
 * mirror of Task.blockedBy and must only be written by the
 * dependency-graph machinery in packages/agent/tasks.ts. External
 * writers can break the bipartite invariant (A.blocks ∋ B ⟺
 * B.blockedBy ∋ A) which deadlocks claimTask.
 *
 * The TaskUpdate tool no longer accepts addBlocks (砍除 by Phase E1),
 * and TaskCreate.blockedBy routes through blockTask. This verifier
 * is a regression guard: any new code that writes to .blocks
 * outside the sanctioned path fails the build.
 *
 * What this rule flags (in packages/, excluding tests, types, and
 * the one approved location):
 *   - `blocks: [...]` as an object literal property (e.g. updateTask
 *     calls assigning a non-empty blocks array)
 *   - `.blocks =` assignments
 *   - `addBlocks:` parameter declarations (the API was removed)
 *
 * Approved location: packages/agent/tasks.ts (blockTask +
 * cascadeUnblockOnCompletion). createTask sets `blocks: []` at
 * construction time which is allowed (init-empty does not break the
 * invariant; only non-empty writes can).
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const APPROVED_FILES = new Set([
  'packages/agent/tasks.ts',
])

function listSourceFiles(): string[] {
  const out = spawnSync(
    'rg',
    [
      '--files',
      '-g', '*.ts',
      '-g', '*.tsx',
      '-g', '!**/__tests__/**',
      '-g', '!**/*.test.ts',
      '-g', '!**/*.test.tsx',
      '-g', '!**/types/generated/**',
      'packages/',
    ],
    { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 50 * 1024 * 1024 },
  )
  return out.stdout.trim().split('\n').filter(Boolean)
}

type Violation = {
  file: string
  line: number
  text: string
  why: string
}

const violations: Violation[] = []

for (const relFile of listSourceFiles()) {
  if (APPROVED_FILES.has(relFile)) continue
  const path = join(REPO_ROOT, relFile)
  let src: string
  try {
    src = readFileSync(path, 'utf8')
  } catch {
    continue
  }
  const lines = src.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    // Skip comments-only lines so doc references don't false-flag.
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue

    // (1) Non-empty `blocks: [` assignment in an object literal that
    //     passes through to updateTask/createTask. The init-empty case
    //     `blocks: []` is permitted.
    if (
      /\bblocks:\s*\[[^\]]/.test(line) &&
      !/\bblocks:\s*\[\s*\]/.test(line)
    ) {
      // Coarse filter: ignore tool-permission "blocks" arrays that
      // share the field name but live in unrelated structures.
      if (
        line.includes('toolUse') ||
        line.includes('isConcurrencySafe') ||
        line.includes('content') ||
        line.includes('Block') // ContentBlock / TextBlock etc.
      ) {
        continue
      }
      violations.push({
        file: relFile,
        line: i + 1,
        text: trimmed,
        why: 'non-empty blocks: [...] write — use blockTask() instead',
      })
      continue
    }

    // (2) `.blocks =` direct mutation
    if (/\.blocks\s*=\s*[^=]/.test(line)) {
      // Filter unrelated `.blocks` properties (Slate's text blocks etc.)
      if (
        line.includes('this.contentBlocks') ||
        line.includes('parsedBlocks')
      ) {
        continue
      }
      // Filter tasks.ts's own internal mutation (we approved that file).
      violations.push({
        file: relFile,
        line: i + 1,
        text: trimmed,
        why: 'direct .blocks mutation — use blockTask() instead',
      })
      continue
    }

    // (3) `addBlocks:` schema/parameter (the API was removed in
    //     Phase E1; flag anywhere it reappears).
    if (/\baddBlocks\b/.test(line)) {
      violations.push({
        file: relFile,
        line: i + 1,
        text: trimmed,
        why: 'addBlocks API was removed (one-name-per-thing) — use addBlockedBy on the dependent task',
      })
    }
  }
}

if (violations.length > 0) {
  console.error('verify-task-blocks-internal-only: violations')
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}: ${v.why}`)
    console.error(`    ${v.text}`)
  }
  console.error(
    `\n→ Task.blocks is the internal half of the bipartite dependency graph; only blockTask/cascadeUnblockOnCompletion in packages/agent/tasks.ts should write it. External writes break the A.blocks ∋ B ⟺ B.blockedBy ∋ A invariant.`,
  )
  process.exit(1)
}

console.log(
  `task-blocks-internal-only: clean (${listSourceFiles().length} files scanned, 1 file allow-listed)`,
)
