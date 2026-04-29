import { describe, expect, test } from 'bun:test'
import { toInkColor } from '../inkColor.js'

describe('toInkColor — undefined / falsy input', () => {
  test('undefined returns DEFAULT_AGENT_THEME_COLOR', () => {
    expect(toInkColor(undefined)).toBe('cyan_FOR_SUBAGENTS_ONLY')
  })

  test('empty string returns DEFAULT_AGENT_THEME_COLOR', () => {
    // Contract: !color is the falsy guard. Empty string falls through
    // to default (NOT mapped to a theme color, NOT prefixed with ansi:).
    expect(toInkColor('')).toBe('cyan_FOR_SUBAGENTS_ONLY')
  })
})

describe('toInkColor — known agent colors', () => {
  // Without importing AGENT_COLOR_TO_THEME_COLOR (module-level state in
  // host bindings), we test the OBSERVABLE contract: known colors get
  // mapped to theme keys (NOT prefixed with "ansi:"); unknown colors
  // get the "ansi:" prefix.

  test('"red" maps to a non-ansi-prefixed theme color', () => {
    const result = toInkColor('red')
    expect(typeof result).toBe('string')
    // Should be a theme color key, not "ansi:red".
    expect(result).not.toContain('ansi:')
  })

  test('"blue" maps to theme color', () => {
    const result = toInkColor('blue')
    expect(result).not.toContain('ansi:')
  })

  test('"green" maps to theme color', () => {
    const result = toInkColor('green')
    expect(result).not.toContain('ansi:')
  })
})

describe('toInkColor — unknown color fallback', () => {
  test('unknown color gets "ansi:" prefix', () => {
    expect(toInkColor('hotpink')).toBe('ansi:hotpink')
  })

  test('hex-style color string gets "ansi:" prefix', () => {
    expect(toInkColor('#ff00ff')).toBe('ansi:#ff00ff')
  })

  test('uppercase known color name → fallback (case-sensitive lookup)', () => {
    // Critical: agent color name lookup is case-sensitive. 'RED' is
    // NOT a known agent color → falls through to ansi: prefix.
    // Catches a refactor that adds .toLowerCase() to the lookup.
    expect(toInkColor('RED')).toBe('ansi:RED')
  })

  test('color with whitespace → ansi:fallback (no trim applied)', () => {
    expect(toInkColor(' red ')).toBe('ansi: red ')
  })
})

describe('toInkColor — return type', () => {
  test('always returns a non-empty string for non-falsy input', () => {
    const samples = ['red', 'unknown', '#abc', 'RED']
    for (const s of samples) {
      const result = toInkColor(s)
      expect(typeof result).toBe('string')
      expect((result as string).length).toBeGreaterThan(0)
    }
  })
})
