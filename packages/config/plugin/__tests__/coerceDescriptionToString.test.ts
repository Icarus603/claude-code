import { describe, expect, test } from 'bun:test'
import { coerceDescriptionToString } from '../_deps.js'

// V9-2.7 regression: a broken local stub at _deps.ts had been shadowing
// the real coerceDescriptionToString from frontmatterParser.ts. The stub
// took 1 arg, returned `''` instead of `null` on invalid input, and had
// signature `(v: unknown): string`. Every plugin loader callsite uses
// the 2-arg form `coerceDescriptionToString(value, name)` and chains
// `?? extractDescriptionFromMarkdown(...)` for fallback — the stub
// broke that chain because `'' ?? x` is `''`, not `x`.
//
// Fix: _deps.ts now `export { coerceDescriptionToString } from
// '../frontmatterParser.js'`. This test pins the contract that imports
// from `_deps.js` get the REAL impl: signature `(value, componentName?,
// pluginName?): string | null`, returns null on invalid input so `??`
// fallback fires.

describe('coerceDescriptionToString re-exported from _deps', () => {
  test('returns null for null input (NOT empty string)', () => {
    // The broken stub returned '' here. The real impl returns null,
    // letting `??` fallback fire at callsite.
    expect(coerceDescriptionToString(null)).toBeNull()
  })

  test('returns null for undefined input (NOT empty string)', () => {
    expect(coerceDescriptionToString(undefined)).toBeNull()
  })

  test('returns null for empty/whitespace strings (NOT empty string)', () => {
    // Real impl trims and returns null for whitespace-only.
    expect(coerceDescriptionToString('')).toBeNull()
    expect(coerceDescriptionToString('   ')).toBeNull()
  })

  test('accepts componentName as 2nd arg without TypeError', () => {
    // The broken stub took 1 arg; passing 2 args used to silently work
    // because JS drops extras, but TypeScript would error. The real
    // impl has the (value, componentName?, pluginName?) signature.
    expect(() =>
      coerceDescriptionToString('hello', 'agent-name'),
    ).not.toThrow()
    expect(coerceDescriptionToString('hello', 'agent-name')).toBe('hello')
  })

  test('returns trimmed string for string input', () => {
    expect(coerceDescriptionToString('  hello  ')).toBe('hello')
  })

  test('coerces numbers and booleans', () => {
    expect(coerceDescriptionToString(42)).toBe('42')
    expect(coerceDescriptionToString(true)).toBe('true')
  })

  test('returns null (NOT String(obj)) for objects/arrays — invalid descriptions', () => {
    // The broken stub ran `String([])` → '' and `String({})` →
    // '[object Object]'. The real impl returns null on non-scalar.
    expect(coerceDescriptionToString([])).toBeNull()
    expect(coerceDescriptionToString({ k: 'v' })).toBeNull()
  })
})
