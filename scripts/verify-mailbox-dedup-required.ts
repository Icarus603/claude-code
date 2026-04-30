#!/usr/bin/env bun
/**
 * verify-mailbox-dedup-required — every protocol message that
 * carries a `requestId` field MUST be sent through writeToMailbox
 * (which deduplicates on (type, requestId)). Direct atomicWriteFile
 * or messages.push to an inbox bypasses dedup, which is the bug
 * class that locked fixer-agent in "approved but stuck" limbo when
 * the leader retried a shutdown_request.
 *
 * Heuristic: scan packages/swarm/src/mailbox/index.ts for
 * z.object({ type: z.literal('...'), requestId: z.string(), ... })
 * shapes. Each one is a protocol message that should be written via
 * writeToMailbox. Then scan the rest of packages/ for any direct
 * mutation of an inbox file (atomicWriteFile to a path containing
 * 'inboxes' or 'mailbox', or `messages.push(...)` against the
 * inbox-file shape) — flag if found OUTSIDE the mailbox/index.ts
 * implementation file (which is the canonical writer).
 *
 * The mailbox/index.ts impl itself contains writeToMailbox + the
 * canonical lockfile + atomicWriteFile sequence; that's the only
 * approved location.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const APPROVED_WRITER_FILE = 'packages/swarm/src/mailbox/index.ts'

type Violation = { file: string; line: number; text: string; why: string }

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

const violations: Violation[] = []

for (const relFile of listSourceFiles()) {
  if (relFile === APPROVED_WRITER_FILE) continue
  let src: string
  try {
    src = readFileSync(`${REPO_ROOT}/${relFile}`, 'utf8')
  } catch {
    continue
  }
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue

    // (1) atomicWriteFile to an inbox path
    if (
      /atomicWriteFile\(/.test(line) &&
      (line.includes('inbox') || line.includes('mailbox'))
    ) {
      violations.push({
        file: relFile,
        line: i + 1,
        text: trimmed,
        why: 'direct atomicWriteFile to a mailbox/inbox path bypasses (type, requestId) dedup — call writeToMailbox instead',
      })
      continue
    }

    // (2) writeFile / appendFile to an inbox path (excluding the
    //     "ensure file exists" idempotent create with `flag: 'wx'`,
    //     which writeToMailbox itself uses).
    if (
      /\b(writeFile|appendFile)\(/.test(line) &&
      (line.includes('inbox') || line.includes('mailbox')) &&
      !line.includes("'wx'")
    ) {
      violations.push({
        file: relFile,
        line: i + 1,
        text: trimmed,
        why: 'direct writeFile/appendFile to a mailbox path bypasses dedup — call writeToMailbox instead',
      })
    }
  }
}

if (violations.length > 0) {
  console.error('verify-mailbox-dedup-required: violations')
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}: ${v.why}`)
    console.error(`    ${v.text}`)
  }
  console.error(
    `\n→ writeToMailbox is the single approved writer for inbox files. It deduplicates on (type, requestId) so retried protocol messages collapse to one entry — the bypass kind reintroduces the fixer-agent shutdown deadlock from 2026-04-30.`,
  )
  process.exit(1)
}

console.log(
  `mailbox-dedup-required: clean (1 file allow-listed: ${APPROVED_WRITER_FILE})`,
)
