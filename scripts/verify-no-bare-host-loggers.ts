#!/usr/bin/env bun
/**
 * verify-no-bare-host-loggers — host-binding loggers must not be called
 * without going through `getAgentHostBindings()` / `getPermissionHostBindings()`
 * etc. or being explicitly imported from `@claude-code/local-observability`.
 *
 * Why this matters:
 *   `packages/agent/internal/fileHistoryCore.ts:786` (fixed in 94d6c10d) had
 *   one bare `logEvent(...)` call left behind from the host-binding migration.
 *   Every other call site in that file used `getAgentHostBindings().logEvent?.()`.
 *   The bare call threw `ReferenceError: logEvent is not defined` at runtime,
 *   AFTER the disk backup was written but BEFORE the result was assigned to
 *   the trackedFileBackups map. The surrounding try/catch silently swallowed
 *   the error via `logError` — and `logError` itself is also a host-binding
 *   that may have been swallowed too. Net effect: rewind file-history snapshots
 *   were permanently broken; every "Restore code" choice in the rewind dialog
 *   would have deleted every tracked file from disk.
 *
 *   Subsequent scan (2026-04-29) found the same migration miss in
 *   cronSchedulerCore.ts:323/347 (bare logForDebugging in catch handlers,
 *   inside Promise rejection paths — same swallowed-error invisibility) and
 *   packageHostSetupOrchestrator.ts:825-826 (bare logEvent in security-dialog
 *   accept/reject callbacks — would have thrown the moment a user clicked).
 *
 * What this verifier flags:
 *   A bare call to `logEvent`, `logError`, `logDebug`, `logForDebugging`, or
 *   `logAntError` where the file does NOT:
 *     1. import the function from any module, OR
 *     2. declare it locally (function, const, let, var, destructure)
 *
 * Permitted patterns:
 *   - `getAgentHostBindings().logEvent?.(...)`  ← member access, not bare
 *   - `import { logEvent } from '@claude-code/local-observability'`  ← imported
 *   - `const { logEvent } = require(...)`  ← destructured
 *   - `function logEvent(...) { ... }`  ← local declaration (in host bindings)
 */

import { Glob } from 'bun'
import { readFile } from 'fs/promises'

const LOGGERS = ['logEvent', 'logError', 'logDebug', 'logForDebugging', 'logAntError']

type Violation = { file: string; fn: string; line: number; snippet: string }

const violations: Violation[] = []

for await (const file of new Glob('packages/**/*.{ts,tsx}').scan('.')) {
  if (file.includes('node_modules/')) continue
  if (file.includes('__tests__/') || file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue
  if (file.endsWith('.d.ts')) continue
  if (file.includes('/dist/')) continue

  const src = await readFile(file, 'utf8')

  for (const fn of LOGGERS) {
    // Quick reject: file doesn't even mention this function name
    if (!src.includes(fn)) continue

    // Check if this file legitimately has the function in scope
    const hasImport = new RegExp(`import[^;]*?\\b${fn}\\b[^;]*?from`, 'm').test(src)
    const hasFnDecl = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${fn}\\b`, 'm').test(src)
    const hasVarDecl = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:const|let|var)\\s+${fn}\\b`, 'm').test(src)
    const hasDestructure = new RegExp(`(?:const|let|var)\\s*\\{[^}]*\\b${fn}\\b[^}]*\\}\\s*=`, 'm').test(src)
    if (hasImport || hasFnDecl || hasVarDecl || hasDestructure) continue

    // Find bare calls — `fn(` not preceded by .|\w|"|'
    const callRe = new RegExp(`(?:^|[^\\w.'\"])${fn}\\s*\\(`, 'gm')
    let m: RegExpExecArray | null
    while ((m = callRe.exec(src)) !== null) {
      const lineStart = src.lastIndexOf('\n', m.index) + 1
      const lineEnd = src.indexOf('\n', m.index)
      const line = src.slice(lineStart, lineEnd === -1 ? src.length : lineEnd)
      const lineNo = src.slice(0, m.index).split('\n').length

      // The fn position relative to start of line
      const fnPos = line.indexOf(fn)
      const afterFn = line.slice(fnPos + fn.length)

      // Skip type signatures: `fn(arg: T): ReturnType` or `fn(arg: T) => ...`
      if (/^\([^)]*\)\s*:\s*\w/.test(afterFn)) continue
      if (/^\([^)]*\)\s*=>/.test(afterFn)) continue
      // Skip method shorthand definition: `fn(arg) { ... }`
      if (/^\([^)]*\)\s*\{/.test(afterFn)) continue
      // Skip JSDoc / comments
      const trimmed = line.trimStart()
      if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue

      violations.push({ file, fn, line: lineNo, snippet: line.trim().slice(0, 120) })
    }
  }
}

if (violations.length > 0) {
  console.error(`✗ no-bare-host-loggers: ${violations.length} bare call(s) found:\n`)
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.fn}]`)
    console.error(`    ${v.snippet}`)
  }
  console.error(`\nWhy this matters:`)
  console.error(`  Bare logger calls without import or local definition throw ReferenceError`)
  console.error(`  at runtime, typically inside try/catch handlers that silently swallow them.`)
  console.error(`  See packages/agent/internal/fileHistoryCore.ts:786 (fixed in 94d6c10d) for`)
  console.error(`  the canonical incident: rewind file-history snapshots were permanently`)
  console.error(`  broken because one bare logEvent call threw between the disk backup write`)
  console.error(`  and the in-memory commit.\n`)
  console.error(`Fix: route through the appropriate host binding`)
  console.error(`  (e.g. \`getAgentHostBindings().logEvent?.(...)\`) or add a real import.`)
  process.exit(1)
}

console.log('no-bare-host-loggers check passed')
