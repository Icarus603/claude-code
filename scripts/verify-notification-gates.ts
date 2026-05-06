#!/usr/bin/env bun
/**
 * verify-notification-gates — packages/repl/src/notifier.ts is the single
 * dispatcher for OS-level banners. It gates centrally via
 * notificationPolicy.ts:shouldFireBanner. Anything that calls
 * `terminal.notifyITerm2 / notifyKitty / notifyGhostty / notifyBell` from
 * outside the dispatcher bypasses the gate and is a regression.
 *
 * The dispatcher itself is exempt (it IS the gate). Direct terminal calls
 * elsewhere fail unless flagged with `// notification:ungated reason=…`
 * within 5 lines above (escape hatch — should be exceedingly rare).
 *
 * Exact-match rule (not a ratchet). Excludes __tests__ / .test.* / .d.ts.
 *
 * Why the rule exists: ant 2.1.131 had a documented gap where banner
 * callsites (PermissionRequest, MCP elicitation, OAuth) bypassed any
 * notification-policy check. The 2026-05-06 ccb refactor centralized
 * gating in notifier.ts; this verifier locks that contract so a future
 * port can't reintroduce direct-to-terminal calls.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const PACKAGES_DIR = join(REPO_ROOT, 'packages')

const DISPATCHER = join(REPO_ROOT, 'packages/repl/src/notifier.ts')
const POLICY = join(REPO_ROOT, 'packages/repl/src/notificationPolicy.ts')

// Files that legitimately reach into terminal.notify* APIs. Currently
// only the dispatcher itself.
const EXEMPT_FILES = new Set([DISPATCHER])

// Files that the verifier requires to exist — a refactor that moves the
// dispatcher without updating this list should fail loudly.
const REQUIRED_FILES = [DISPATCHER, POLICY]

const UNGATED_TAG = 'notification:ungated'

// `terminal.notifyITerm2(`, `terminal.notifyKitty(`, etc. Match dot-call
// on a `terminal` identifier; exclude `Terminal.method` (capitalized
// types) and unrelated dot-calls.
const TERMINAL_NOTIFY_RE = /\bterminal\.notify[A-Z]\w*\s*\(/

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

type Violation = { file: string; line: number; text: string }

function hasUngatedTagAbove(lines: string[], lineIdx: number): boolean {
  const start = Math.max(0, lineIdx - 5)
  for (let i = start; i < lineIdx; i++) {
    if (lines[i]!.includes(UNGATED_TAG)) return true
  }
  return false
}

function scanFile(filePath: string): Violation[] {
  if (EXEMPT_FILES.has(filePath)) return []

  const content = readFileSync(filePath, 'utf-8')
  if (!content.includes('terminal.notify')) return []

  const lines = content.split('\n')
  const violations: Violation[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!TERMINAL_NOTIFY_RE.test(line)) continue
    if (hasUngatedTagAbove(lines, i)) continue
    violations.push({ file: filePath, line: i + 1, text: line.trim() })
  }
  return violations
}

async function main(): Promise<void> {
  for (const f of REQUIRED_FILES) {
    let ok = true
    try {
      statSync(f)
    } catch {
      ok = false
    }
    if (!ok) {
      console.error(
        `verify-notification-gates: required file missing: ${relative(REPO_ROOT, f)}`,
      )
      console.error(
        '  The verifier expects this file to exist as the canonical dispatcher / policy.',
      )
      console.error(
        '  If you moved it, update REQUIRED_FILES in scripts/verify-notification-gates.ts.',
      )
      process.exit(1)
    }
  }

  const files = findTsFiles(PACKAGES_DIR)
  const violations: Violation[] = []
  for (const f of files) {
    violations.push(...scanFile(f))
  }

  if (violations.length === 0) {
    console.log(
      `verify-notification-gates: ${files.length} files scanned, no direct terminal.notify* callsites outside dispatcher.`,
    )
    return
  }

  console.error(
    `verify-notification-gates: ${violations.length} violation(s).`,
  )
  console.error('')
  console.error(
    'Direct terminal.notifyXxx(...) calls bypass packages/repl/src/notifier.ts',
  )
  console.error(
    '→ shouldFireBanner gate. Route through sendNotification or, if you have a',
  )
  console.error(
    'legitimate exception, add this comment within 5 lines above the call:',
  )
  console.error('')
  console.error(`  // ${UNGATED_TAG} reason=<why this bypasses the gate>`)
  console.error('')
  console.error('Violations:')
  for (const v of violations) {
    const rel = relative(REPO_ROOT, v.file)
    console.error(`  ${rel}:${v.line}  ${v.text}`)
  }
  process.exit(1)
}

await main()
