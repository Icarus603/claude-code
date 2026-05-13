import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

import {
  getAutoModeDenials,
  recordAutoModeDenial,
} from '../autoModeDenials.ts'

/**
 * Pin `autoModeDenials.ts` — the in-memory ring buffer that powers the
 * RecentDenialsTab in /permissions.
 *
 * Note on test scope: bun:test runs with feature flags OFF (see
 * feedback_bun_test_feature_flags_off.md). TRANSCRIPT_CLASSIFIER is gated,
 * so recordAutoModeDenial is a no-op in this environment. We pin the
 * SHAPE behaviors that are still observable:
 *   1. getAutoModeDenials returns an array (NOT undefined).
 *   2. recordAutoModeDenial is a no-op under feature flag off (state
 *      unchanged after call).
 *   3. MAX_DENIALS cap = 20 in source.
 *   4. Feature gate name = 'TRANSCRIPT_CLASSIFIER' in source.
 */
describe('autoModeDenials — runtime', () => {
  test('getAutoModeDenials returns array (readonly)', () => {
    const result = getAutoModeDenials()
    expect(Array.isArray(result)).toBe(true)
  })

  test('record under feature-flag-off (bun:test) is no-op', () => {
    // bun:test → feature('TRANSCRIPT_CLASSIFIER') === false → recordAutoModeDenial
    // returns without mutation.
    const before = getAutoModeDenials()
    recordAutoModeDenial({
      toolName: 'Bash',
      display: 'rm -rf /',
      reason: 'dangerous',
      timestamp: Date.now(),
    })
    const after = getAutoModeDenials()
    // Both are the same reference (or at least same length).
    expect(after.length).toBe(before.length)
  })

  test('returned array is readonly (TypeScript)', () => {
    // Pin: the return type is `readonly AutoModeDenial[]`. We can't
    // enforce runtime read-only with Object.freeze, but we can pin that
    // the result IS the live array (not a copy that costs N).
    const a = getAutoModeDenials()
    const b = getAutoModeDenials()
    // Same ref (no defensive copy).
    expect(a).toBe(b)
  })
})

describe('autoModeDenials — source pins', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'autoModeDenials.ts'),
    'utf-8',
  )

  test('MAX_DENIALS = 20 (ring buffer cap)', () => {
    // Pin: the UI scroll budget. Raising would balloon memory if many
    // denials happen quickly; lowering would hide history.
    expect(source).toMatch(/MAX_DENIALS = 20/)
  })

  test('Feature gate name: TRANSCRIPT_CLASSIFIER', () => {
    // Pin: must match scripts/default-features.ts and the feature flag
    // registry. A typo would silently always-bypass.
    expect(source).toMatch(/feature\('TRANSCRIPT_CLASSIFIER'\)/)
  })

  test('recordAutoModeDenial early-returns when flag off', () => {
    expect(source).toMatch(
      /if \(!feature\('TRANSCRIPT_CLASSIFIER'\)\) return/,
    )
  })

  test('ring buffer uses prepend + slice (LIFO order)', () => {
    // Pin: [newest, ...prev.slice(0, MAX_DENIALS - 1)]. UI shows newest
    // at top. A regression to [...prev, newest] would push oldest first
    // and either grow unbounded or drop newest.
    expect(source).toMatch(
      /DENIALS = \[denial, \.\.\.DENIALS\.slice\(0, MAX_DENIALS - 1\)\]/,
    )
  })

  test('AutoModeDenial type has 4 fields: toolName, display, reason, timestamp', () => {
    // Pin: wire format for the UI.
    expect(source).toMatch(/toolName: string/)
    expect(source).toMatch(/display: string/)
    expect(source).toMatch(/reason: string/)
    expect(source).toMatch(/timestamp: number/)
  })

  test('module-level DENIALS is `let` (not const) — required for ring buffer mutation', () => {
    // Pin: const would prevent reassignment. The reassign-immutable
    // pattern (new array each time) is correct; pinning `let` is the
    // structural cue.
    expect(source).toMatch(
      /let DENIALS: readonly AutoModeDenial\[\] = \[\]/,
    )
  })
})
