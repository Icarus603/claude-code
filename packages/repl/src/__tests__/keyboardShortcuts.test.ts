import { describe, expect, test } from 'bun:test'
import {
  MACOS_OPTION_SPECIAL_CHARS,
  isMacosOptionChar,
} from '../keyboardShortcuts.js'

describe('MACOS_OPTION_SPECIAL_CHARS — wire-format anchor', () => {
  // These are the actual characters macOS terminals emit when the user
  // presses Option+T/P/O without "Option as Meta" enabled. They're not
  // arbitrary — they come from the macOS keyboard's compose layer. If
  // the mapping ever changes (e.g., a refactor accidentally substitutes
  // the wrong glyph), Option+T will silently stop triggering thinking
  // mode and the user has no way to know why.

  test('† maps to alt+t (Option+T → thinking toggle)', () => {
    expect(MACOS_OPTION_SPECIAL_CHARS['†']).toBe('alt+t')
  })

  test('π maps to alt+p (Option+P → model picker)', () => {
    expect(MACOS_OPTION_SPECIAL_CHARS['π']).toBe('alt+p')
  })

  test('ø maps to alt+o (Option+O → fast mode)', () => {
    expect(MACOS_OPTION_SPECIAL_CHARS['ø']).toBe('alt+o')
  })

  test('exactly 3 entries (no silent additions)', () => {
    expect(Object.keys(MACOS_OPTION_SPECIAL_CHARS).length).toBe(3)
  })

  test('all values match the alt+<lowercase-letter> pattern', () => {
    // Catches accidental substitution of the wrong target keybinding.
    for (const [_, target] of Object.entries(MACOS_OPTION_SPECIAL_CHARS)) {
      expect(target).toMatch(/^alt\+[a-z]$/)
    }
  })
})

describe('isMacosOptionChar', () => {
  test('returns true for † (cross/dagger)', () => {
    expect(isMacosOptionChar('†')).toBe(true)
  })
  test('returns true for π (pi)', () => {
    expect(isMacosOptionChar('π')).toBe(true)
  })
  test('returns true for ø (slashed o)', () => {
    expect(isMacosOptionChar('ø')).toBe(true)
  })

  test('returns false for plain ASCII letters', () => {
    expect(isMacosOptionChar('t')).toBe(false)
    expect(isMacosOptionChar('p')).toBe(false)
    expect(isMacosOptionChar('o')).toBe(false)
    expect(isMacosOptionChar('T')).toBe(false)
  })

  test('returns false for other unicode chars', () => {
    expect(isMacosOptionChar('Ω')).toBe(false) // Option+Z would be Ω but not mapped
    expect(isMacosOptionChar('é')).toBe(false)
    expect(isMacosOptionChar('™')).toBe(false)
  })

  test('returns false for empty string', () => {
    expect(isMacosOptionChar('')).toBe(false)
  })

  test('returns false for multi-char input', () => {
    // Only single chars are mapped; multi-char strings are not in the
    // record's key set.
    expect(isMacosOptionChar('†t')).toBe(false)
  })

  test('type narrows correctly when true (compile-time contract)', () => {
    const c: string = '†'
    if (isMacosOptionChar(c)) {
      // After the type guard, c should be narrowed to keyof
      // MACOS_OPTION_SPECIAL_CHARS, allowing safe lookup.
      const target: string = MACOS_OPTION_SPECIAL_CHARS[c]
      expect(target).toBe('alt+t')
    }
  })
})
