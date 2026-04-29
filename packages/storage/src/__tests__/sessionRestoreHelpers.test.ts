/**
 * Tests for sessionRestore.ts pure functions — exercised on every --resume.
 *
 * computeStandaloneAgentContext is called before render (main.tsx) so its
 * return value is the seed state for the standalone agent badge in the
 * REPL banner. A wrong "default → undefined" mapping there causes the
 * badge to show "default" as the literal color name.
 */
import { describe, expect, test } from 'bun:test'
import { computeStandaloneAgentContext } from '../sessionRestore.js'

describe('computeStandaloneAgentContext', () => {
  test('both undefined → undefined (no badge)', () => {
    expect(computeStandaloneAgentContext(undefined, undefined)).toBeUndefined()
  })

  test('name only → returns name with color undefined', () => {
    expect(computeStandaloneAgentContext('alice', undefined)).toEqual({
      name: 'alice',
      color: undefined,
    })
  })

  test('color only → returns empty name with that color', () => {
    expect(computeStandaloneAgentContext(undefined, 'blue')).toEqual({
      name: '',
      color: 'blue',
    })
  })

  test('"default" color is normalised to undefined', () => {
    // Documented behavior: agentColor === 'default' is sentinel for "no
    // explicit color", so it strips down to undefined. Without this the
    // badge would render the literal word "default" as the colour name.
    expect(computeStandaloneAgentContext('alice', 'default')).toEqual({
      name: 'alice',
      color: undefined,
    })
  })

  test('case-sensitive: "Default" (capital D) is NOT normalised', () => {
    // The check is `agentColor === 'default'` (strict). 'Default' passes
    // through. This is documented behavior of the comparison.
    const r = computeStandaloneAgentContext('alice', 'Default')
    expect(r?.color).toBe('Default')
  })

  test('empty string color is preserved (not "default" → not stripped)', () => {
    const r = computeStandaloneAgentContext('alice', '')
    // Empty string falls through the `&& agentColor` guard at the top
    // (returns undefined for "both falsy"), but if agentName is set we
    // get name with empty color string.
    expect(r).toEqual({ name: 'alice', color: '' })
  })

  test('both empty strings → undefined (both falsy)', () => {
    // Falsy guard: !agentName && !agentColor returns undefined.
    expect(computeStandaloneAgentContext('', '')).toBeUndefined()
  })

  test('whitespace-only name is preserved (truthy string)', () => {
    // ' ' is truthy in JS — the guard doesn't trim. Documents the
    // documented behavior.
    const r = computeStandaloneAgentContext(' ', 'red')
    expect(r).toEqual({ name: ' ', color: 'red' })
  })
})
