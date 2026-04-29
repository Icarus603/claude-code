/**
 * Tests for isNonSpacePrintable — gates the lazy space-after-image-pill
 * insertion. Wrong gate either:
 *   - inserts a space when arrow keys are pressed (cursor jumps)
 *   - skips the space on real letter keys (image pill smushed against text)
 *
 * The function is "is this a normal printable char (letter/digit/symbol)
 * that's not a control key, modifier key, navigation key, or whitespace?"
 */
import { describe, expect, test } from 'bun:test'
import { isNonSpacePrintable } from '../components/PromptInput/utils.js'
import type { Key } from '@anthropic/ink'

function key(over: Partial<Key> = {}): Key {
  // Default Key has all flags false.
  return {
    ctrl: false,
    meta: false,
    escape: false,
    return: false,
    tab: false,
    backspace: false,
    delete: false,
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageUp: false,
    pageDown: false,
    home: false,
    end: false,
    shift: false,
    ...over,
  } as Key
}

describe('isNonSpacePrintable — printable characters', () => {
  test('lowercase letter → true', () => {
    expect(isNonSpacePrintable('a', key())).toBe(true)
  })

  test('uppercase letter → true (shift modifier OK)', () => {
    expect(isNonSpacePrintable('A', key({ shift: true }))).toBe(true)
  })

  test('digit → true', () => {
    expect(isNonSpacePrintable('5', key())).toBe(true)
  })

  test('symbol → true', () => {
    expect(isNonSpacePrintable('!', key())).toBe(true)
    expect(isNonSpacePrintable('?', key())).toBe(true)
    expect(isNonSpacePrintable('@', key())).toBe(true)
  })

  test('multi-char paste (lifelike) → true if no leading whitespace', () => {
    // Pastes can come through as multi-char input.
    expect(isNonSpacePrintable('hello', key())).toBe(true)
  })

  test('CJK character → true', () => {
    expect(isNonSpacePrintable('中', key())).toBe(true)
  })
})

describe('isNonSpacePrintable — control / modifier keys', () => {
  test('Ctrl+C → false', () => {
    expect(isNonSpacePrintable('c', key({ ctrl: true }))).toBe(false)
  })

  test('Cmd/Meta key → false', () => {
    expect(isNonSpacePrintable('a', key({ meta: true }))).toBe(false)
  })

  test('Escape → false', () => {
    expect(isNonSpacePrintable('', key({ escape: true }))).toBe(false)
  })

  test('Enter/Return → false', () => {
    expect(isNonSpacePrintable('\r', key({ return: true }))).toBe(false)
  })

  test('Tab → false', () => {
    expect(isNonSpacePrintable('\t', key({ tab: true }))).toBe(false)
  })

  test('Backspace → false', () => {
    expect(isNonSpacePrintable('', key({ backspace: true }))).toBe(false)
  })

  test('Delete → false', () => {
    expect(isNonSpacePrintable('', key({ delete: true }))).toBe(false)
  })
})

describe('isNonSpacePrintable — navigation keys', () => {
  test('Up arrow → false', () => {
    expect(isNonSpacePrintable('', key({ upArrow: true }))).toBe(false)
  })

  test('Down arrow → false', () => {
    expect(isNonSpacePrintable('', key({ downArrow: true }))).toBe(false)
  })

  test('Left arrow → false', () => {
    expect(isNonSpacePrintable('', key({ leftArrow: true }))).toBe(false)
  })

  test('Right arrow → false', () => {
    expect(isNonSpacePrintable('', key({ rightArrow: true }))).toBe(false)
  })

  test('Home/End → false', () => {
    expect(isNonSpacePrintable('', key({ home: true }))).toBe(false)
    expect(isNonSpacePrintable('', key({ end: true }))).toBe(false)
  })

  test('PageUp/PageDown → false', () => {
    expect(isNonSpacePrintable('', key({ pageUp: true }))).toBe(false)
    expect(isNonSpacePrintable('', key({ pageDown: true }))).toBe(false)
  })
})

describe('isNonSpacePrintable — whitespace guards', () => {
  test('empty string → false (nothing to print)', () => {
    expect(isNonSpacePrintable('', key())).toBe(false)
  })

  test('leading space → false', () => {
    expect(isNonSpacePrintable(' hello', key())).toBe(false)
  })

  test('lone space → false', () => {
    expect(isNonSpacePrintable(' ', key())).toBe(false)
  })

  test('lone tab → false (whitespace check)', () => {
    expect(isNonSpacePrintable('\t', key())).toBe(false)
  })

  test('newline → false', () => {
    expect(isNonSpacePrintable('\n', key())).toBe(false)
  })

  test('escape sequence (\\x1b prefix) → false', () => {
    // ANSI escape sequences come through as input — must NOT trigger
    // the lazy-space insert.
    expect(isNonSpacePrintable('\x1b[A', key())).toBe(false)
  })
})
