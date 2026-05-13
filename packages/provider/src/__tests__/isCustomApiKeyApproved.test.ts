import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for isCustomApiKeyApproved vs ant NX1 (1997.js):
 *
 *   function NX1(H) {
 *     let _ = S_(),                // getGlobalConfig
 *         q = CS(H);                // normalizeApiKeyForConfig (sha256-based)
 *     return _.customApiKeyResponses?.approved?.includes(q) ?? !1
 *   }
 *
 * We can't directly exec the function in isolation because the real
 * `getGlobalConfig` and `normalizeApiKeyForConfig` are bun-mock-hostile
 * (destructured-const imports). Source-pin invariants:
 *  1. Reads getGlobalConfig() (not a stale top-level capture)
 *  2. Normalizes the input BEFORE checking the approved list (raw equality
 *     would leak via mismatch on whitespace / SHA prefix changes)
 *  3. Optional chain at every level (approved-list may be undefined)
 *  4. ?? false fallback (not || — preserves explicit false vs missing)
 */
describe('isCustomApiKeyApproved (ant NX1 parity)', () => {
  const authAliasSource = readFileSync(
    resolve(__dirname, '..', 'authAlias.ts'),
    'utf-8',
  )

  test('reads getGlobalConfig() fresh on each invocation (not module-level capture)', () => {
    const fnStart = authAliasSource.indexOf('export function isCustomApiKeyApproved')
    expect(fnStart).toBeGreaterThan(0)
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 400)
    expect(fnSlice).toMatch(/const config = getGlobalConfig\(\)/)
  })

  test('normalizes the key BEFORE comparing against approved list', () => {
    const fnStart = authAliasSource.indexOf('export function isCustomApiKeyApproved')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 400)
    const normalizeIdx = fnSlice.indexOf('normalizeApiKeyForConfig(apiKey)')
    const includesIdx = fnSlice.indexOf('.includes(normalizedKey)')
    expect(normalizeIdx).toBeGreaterThan(0)
    expect(includesIdx).toBeGreaterThan(normalizeIdx)
  })

  test('optional chains both customApiKeyResponses and approved (handles undefined config field)', () => {
    expect(authAliasSource).toMatch(
      /config\.customApiKeyResponses\?\.approved\?\.includes\(normalizedKey\)/,
    )
  })

  test('?? false fallback (not || — preserves false vs undefined distinction)', () => {
    expect(authAliasSource).toMatch(
      /config\.customApiKeyResponses\?\.approved\?\.includes\(normalizedKey\)\s*\?\?\s*false/,
    )
  })

  test('return type is boolean (call sites use it as `if(approved)`)', () => {
    expect(authAliasSource).toMatch(
      /export function isCustomApiKeyApproved\(apiKey:\s*string\)\s*:\s*boolean/,
    )
  })
})
