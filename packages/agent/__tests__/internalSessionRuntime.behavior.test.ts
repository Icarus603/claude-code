import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pins for `internal/sessionRuntime.ts` — session-id / cwd /
 * token-budget facades. Each has a deterministic fallback used in tests
 * and pre-host-init scenarios.
 *
 * Key invariants:
 *  1. getSessionId fallback is "unknown" (used as the sentinel that
 *     telemetry expects when no session has been started).
 *  2. getCwdState chains TWO host fallbacks (current cwd → original cwd)
 *     before bottoming out at process.cwd(). The order matters: a turn
 *     might `cd` away, and we want the current path, not the launch one.
 *  3. getOriginalCwd bottoms out at process.cwd() (single fallback).
 *  4. isSessionPersistenceDisabled defaults to FALSE (persistence ON by
 *     default — a regression to true would silently drop sessions).
 */
describe('internal/sessionRuntime fallbacks', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'internal', 'sessionRuntime.ts'),
    'utf-8',
  )

  test('getSessionId fallback is the literal string "unknown"', () => {
    // Pin: NOT '' or 'no-session'. Analytics joins on this exact value.
    expect(source).toMatch(/getSessionId\?\.\(\) \?\? 'unknown'/)
  })

  test('getSdkBetas: no host → [] (NOT undefined)', () => {
    // Pin: caller spreads ...getSdkBetas() into a headers array.
    expect(source).toMatch(/getSdkBetas\?\.\(\) \?\? \[\]/)
  })

  test('getCurrentTurnTokenBudget: no host → 0', () => {
    expect(source).toMatch(/getCurrentTurnTokenBudget\?\.\(\) \?\? 0/)
  })

  test('getTurnOutputTokens: no host → 0', () => {
    expect(source).toMatch(/getTurnOutputTokens\?\.\(\) \?\? 0/)
  })

  test('incrementBudgetContinuationCount: no host → silent no-op (void)', () => {
    // Pin: void return; no observable result.
    expect(source).toMatch(
      /incrementBudgetContinuationCount\?\.\(\)/,
    )
  })

  test('getCwdState chain: current → original → process.cwd()', () => {
    // Pin: 3-tier fallback. Order is critical — current first, so a
    // /cd in the turn reflects, falling back to original launch dir,
    // then the process default.
    expect(source).toMatch(
      /getCwdState\?\.\(\) \?\?\s*\n?\s*getAgentHostBindings\(\)\.getOriginalCwd\?\.\(\) \?\?\s*\n?\s*process\.cwd\(\)/,
    )
  })

  test('getOriginalCwd: no host → process.cwd() (the binary launch dir)', () => {
    // Pin: simpler fallback. NOT chained — original cwd is exactly that.
    expect(source).toMatch(
      /getOriginalCwd\?\.\(\) \?\? process\.cwd\(\)/,
    )
  })

  test('setCwdState: optional-chain (no-op when host absent)', () => {
    expect(source).toMatch(/setCwdState\?\.\(cwd\)/)
  })

  test('isSessionPersistenceDisabled defaults to FALSE (persistence ON by default)', () => {
    // Pin: critical UX invariant. A regression to `?? true` would
    // silently disable session persistence, dropping conversation
    // history on every quit.
    expect(source).toMatch(
      /isSessionPersistenceDisabled\?\.\(\) \?\? false/,
    )
  })
})
