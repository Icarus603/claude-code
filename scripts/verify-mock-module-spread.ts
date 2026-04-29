#!/usr/bin/env bun
/**
 * verify-mock-module-spread — every `mock.module('@claude-code/...')` block
 * in test files must spread the real module's exports first, OR include
 * an explicit `MOCK_FULL_REPLACE:` justification comment.
 *
 * Why: Bun's `mock.module()` applies globally to the whole `bun test`
 * process. A partial mock that lists only the exports the test cares
 * about silently replaces the WHOLE module — every other test in the
 * suite that touches the same import path gets the partial replacement.
 * This bit us in iteration 4 (channelPermissions.test.ts shadowed
 * slowOperations across the suite). Iteration 5 fixed 7 more sites.
 *
 * This verifier prevents regressions:
 *   1. Find every test file with `mock.module('@claude-code/...')`.
 *   2. For each block, require either:
 *      a) a `...someName` spread expression in the body, OR
 *      b) a `MOCK_FULL_REPLACE:` comment somewhere in the file (explicit
 *         opt-out for the rare cases where loading the real module is
 *         genuinely undesirable, e.g. heavy import chain).
 *
 * Heuristic-based — not a full TS parser — but tight enough to catch
 * regressions in practice. Allowlist via the comment escape hatch.
 *
 * See `feedback_bun_mock_module_global_scope.md` in agent memory.
 */
import { Glob } from 'bun'
import { readFile } from 'fs/promises'

interface Violation {
  file: string
  line: number
  modulePath: string
}

const violations: Violation[] = []

for await (const file of new Glob(
  '{packages,tests}/**/*.{test,spec}.{ts,tsx}',
).scan('.')) {
  if (file.includes('node_modules/')) continue
  const content = await readFile(file, 'utf8')

  // Skip files that don't use mock.module at all.
  if (!content.includes('mock.module(')) continue

  // Find each mock.module block targeting @claude-code/* — those are the
  // cross-package mocks. Local relative-path mocks ('../foo.js' or
  // 'src/foo.js') typically don't intercept anything in this codebase
  // (V7-era paths that no longer resolve), and aren't worth flagging.
  const blockRe =
    /mock\.module\(\s*['"](@claude-code\/[^'"]+)['"]\s*,\s*\(\)\s*=>\s*\(\{([\s\S]*?)\}\)\s*\)/g

  let m: RegExpExecArray | null
  while ((m = blockRe.exec(content))) {
    const modulePath = m[1]
    const body = m[2]
    // Spread pattern: `...someName` somewhere in the body.
    const hasSpread = /\.\.\.[a-zA-Z_$][\w$]*/.test(body)
    if (hasSpread) continue

    // Allow explicit opt-out via a comment within ~10 lines above the
    // mock.module call — same-file scope check, doesn't have to be
    // immediately adjacent.
    const before = content.slice(0, m.index)
    const lines = before.split('\n')
    const startLine = lines.length
    const windowStart = Math.max(0, lines.length - 10)
    const window = lines.slice(windowStart).join('\n')
    if (/MOCK_FULL_REPLACE:/.test(window)) continue

    violations.push({ file, line: startLine, modulePath })
  }
}

if (violations.length > 0) {
  console.error(
    `✗ verify-mock-module-spread: ${violations.length} partial mock(s) without spread or MOCK_FULL_REPLACE justification:`,
  )
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — mock.module('${v.modulePath}', ...)`)
  }
  console.error(
    `\nbun:test mocks apply globally to the whole test process. A partial
mock silently replaces the WHOLE module for every other test in the
suite. Fix by spreading the real exports first:

  const realX = await import('${violations[0]?.modulePath ?? '...'}')
  mock.module('${violations[0]?.modulePath ?? '...'}', () => ({
    ...realX,
    someFn: () => mockedReturn,
  }))

If you genuinely need to replace the whole module (rare — heavy import
chain, etc.), add an inline comment explaining why:
  // MOCK_FULL_REPLACE: <reason>

See agent memory: feedback_bun_mock_module_global_scope.md`,
  )
  process.exit(1)
}

console.log('verify-mock-module-spread: clean')
