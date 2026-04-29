import { describe, expect, test } from 'bun:test'
import {
  MACOS_RESERVED,
  NON_REBINDABLE,
  TERMINAL_RESERVED,
  getReservedShortcuts,
  normalizeKeyForComparison,
} from '../keybindings/reservedShortcuts.js'

describe('normalizeKeyForComparison — case-insensitive', () => {
  test('lowercases all parts', () => {
    expect(normalizeKeyForComparison('CTRL+A')).toBe('ctrl+a')
    expect(normalizeKeyForComparison('Ctrl+Shift+B')).toBe('ctrl+shift+b')
  })
  test('handles already-lowercase', () => {
    expect(normalizeKeyForComparison('ctrl+c')).toBe('ctrl+c')
  })
  test('strips outer whitespace', () => {
    expect(normalizeKeyForComparison('  ctrl+c  ')).toBe('ctrl+c')
  })
})

describe('normalizeKeyForComparison — modifier aliases', () => {
  test('control → ctrl', () => {
    expect(normalizeKeyForComparison('Control+a')).toBe('ctrl+a')
  })
  test('option → alt', () => {
    expect(normalizeKeyForComparison('Option+a')).toBe('alt+a')
  })
  test('opt → alt', () => {
    expect(normalizeKeyForComparison('Opt+a')).toBe('alt+a')
  })
  test('command → cmd', () => {
    expect(normalizeKeyForComparison('Command+a')).toBe('cmd+a')
  })
  test('cmd stays cmd', () => {
    expect(normalizeKeyForComparison('cmd+a')).toBe('cmd+a')
  })
  test('meta stays meta', () => {
    expect(normalizeKeyForComparison('meta+a')).toBe('meta+a')
  })
})

describe('normalizeKeyForComparison — modifier sort order', () => {
  test('sorts modifiers alphabetically', () => {
    // shift+ctrl → ctrl+shift after sort
    expect(normalizeKeyForComparison('shift+ctrl+a')).toBe('ctrl+shift+a')
  })
  test('order-independence — different inputs same key produce same output', () => {
    expect(normalizeKeyForComparison('shift+alt+ctrl+a')).toBe(
      normalizeKeyForComparison('ctrl+alt+shift+a'),
    )
  })
})

describe('normalizeKeyForComparison — chords', () => {
  test('preserves chord steps split by space', () => {
    expect(normalizeKeyForComparison('ctrl+x ctrl+b')).toBe('ctrl+x ctrl+b')
  })
  test('normalizes within each chord step', () => {
    expect(normalizeKeyForComparison('Ctrl+X Ctrl+B')).toBe('ctrl+x ctrl+b')
  })
  test('regression: chord parts do NOT collapse to last step', () => {
    // Previously a buggy implementation split on '+' first, mangling
    // "x ctrl" into a mainKey overwritten by next step.
    const result = normalizeKeyForComparison('ctrl+x ctrl+b')
    expect(result.split(' ').length).toBe(2)
  })
  test('handles tab/newline whitespace as chord separator', () => {
    expect(normalizeKeyForComparison('ctrl+x\tctrl+b')).toBe('ctrl+x ctrl+b')
  })
})

describe('NON_REBINDABLE invariants', () => {
  test('contains ctrl+c (interrupt)', () => {
    expect(NON_REBINDABLE.some(s => s.key === 'ctrl+c')).toBe(true)
  })
  test('contains ctrl+d (exit)', () => {
    expect(NON_REBINDABLE.some(s => s.key === 'ctrl+d')).toBe(true)
  })
  test('contains ctrl+m (= Enter)', () => {
    expect(NON_REBINDABLE.some(s => s.key === 'ctrl+m')).toBe(true)
  })
  test('all entries are severity=error', () => {
    for (const s of NON_REBINDABLE) {
      expect(s.severity).toBe('error')
    }
  })
})

describe('TERMINAL_RESERVED invariants', () => {
  test('contains ctrl+z (SIGTSTP)', () => {
    expect(TERMINAL_RESERVED.some(s => s.key === 'ctrl+z')).toBe(true)
  })
  test('does NOT contain ctrl+s (we use it for stash)', () => {
    expect(TERMINAL_RESERVED.some(s => s.key === 'ctrl+s')).toBe(false)
  })
  test('does NOT contain ctrl+q', () => {
    expect(TERMINAL_RESERVED.some(s => s.key === 'ctrl+q')).toBe(false)
  })
})

describe('MACOS_RESERVED invariants', () => {
  test('contains cmd+c, cmd+v, cmd+x', () => {
    const keys = MACOS_RESERVED.map(s => s.key)
    expect(keys).toContain('cmd+c')
    expect(keys).toContain('cmd+v')
    expect(keys).toContain('cmd+x')
  })
  test('all entries are severity=error', () => {
    for (const s of MACOS_RESERVED) {
      expect(s.severity).toBe('error')
    }
  })
})

describe('getReservedShortcuts — composition', () => {
  test('always includes NON_REBINDABLE', () => {
    const reserved = getReservedShortcuts()
    for (const s of NON_REBINDABLE) {
      expect(reserved.some(r => r.key === s.key)).toBe(true)
    }
  })
  test('always includes TERMINAL_RESERVED', () => {
    const reserved = getReservedShortcuts()
    for (const s of TERMINAL_RESERVED) {
      expect(reserved.some(r => r.key === s.key)).toBe(true)
    }
  })
  test('does not duplicate NON_REBINDABLE entries', () => {
    const reserved = getReservedShortcuts()
    const ctrlC = reserved.filter(s => s.key === 'ctrl+c')
    expect(ctrlC.length).toBe(1)
  })
})
