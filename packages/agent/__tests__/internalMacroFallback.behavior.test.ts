import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for `internal/macroFallback.ts` — fills in `globalThis.MACRO`
 * when running under bun:test or other runtimes that haven't passed the
 * build-time MACRO defines.
 *
 * This is a load-bearing safety net: many modules import MACRO at top level
 * (e.g., `if (MACRO.VERSION === '...')`). If MACRO is undefined when those
 * modules load, the import crashes with a ReferenceError BEFORE any test
 * can run.
 *
 * Invariants:
 *  1. The fallback ONLY fires when MACRO is undefined (guard with typeof).
 *     Production builds get real values via scripts/defines.ts, so we MUST
 *     NOT clobber them.
 *  2. VERSION falls back to CLAUDE_CODE_VERSION env var, then '1.carus.000'
 *     (ccb identifier prefix — distinguishes test/fallback from real ant).
 *  3. BUILD_TIME is `new Date().toISOString()` (current time, NOT the epoch
 *     or empty string).
 *  4. Empty-string defaults for {FEEDBACK_CHANNEL, ISSUES_EXPLAINER,
 *     NATIVE_PACKAGE_URL, PACKAGE_URL, VERSION_CHANGELOG}. Pin the empty
 *     defaults so analytics/test mocks don't see undefined.
 */
describe('internal/macroFallback', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'internal', 'macroFallback.ts'),
    'utf-8',
  )

  test('typeof guard against existing MACRO (no clobber)', () => {
    // Pin: production builds inject MACRO at build time. The fallback
    // MUST guard against overwriting it.
    expect(source).toMatch(/if \(typeof globalThis\.MACRO === 'undefined'\)/)
  })

  test('VERSION priority: CLAUDE_CODE_VERSION env → "1.carus.000" literal', () => {
    expect(source).toMatch(
      /VERSION: readEnv\('CLAUDE_CODE_VERSION'\) \|\| '1\.carus\.000'/,
    )
  })

  test('BUILD_TIME is new Date().toISOString() (current time)', () => {
    expect(source).toMatch(/BUILD_TIME: new Date\(\)\.toISOString\(\)/)
  })

  test('FEEDBACK_CHANNEL defaults to empty string', () => {
    // Pin: analytics code expects a string (possibly empty), not undefined.
    expect(source).toMatch(/FEEDBACK_CHANNEL: ''/)
  })

  test('ISSUES_EXPLAINER / NATIVE_PACKAGE_URL / PACKAGE_URL / VERSION_CHANGELOG all "" defaults', () => {
    expect(source).toMatch(/ISSUES_EXPLAINER: ''/)
    expect(source).toMatch(/NATIVE_PACKAGE_URL: ''/)
    expect(source).toMatch(/PACKAGE_URL: ''/)
    expect(source).toMatch(/VERSION_CHANGELOG: ''/)
  })

  test('readEnv is imported from @claude-code/config/env', () => {
    // Pin: NOT process.env directly — the canonical readEnv allows test
    // overrides and is the only env read sanctioned by the doctor.
    expect(source).toMatch(
      /import \{ readEnv \} from '@claude-code\/config\/env'/,
    )
  })

  test('module has `export {}` to mark it as a module (side-effect import)', () => {
    // Pin: callers do `import './macroFallback.js'` for the side effect.
    // Removing `export {}` makes it a script — TS warns, but more
    // importantly, breaks the dual-context rule.
    expect(source).toMatch(/^export \{\}/m)
  })

  test('side-effect-only module — no exported functions/values', () => {
    // Pin: NO export function/const/class. This module is purely side-
    // effecting; exposing names would invite drift.
    expect(source).not.toMatch(/^export (function|const|class|interface|type)/m)
  })
})
