/**
 * Tests for padAligned — used by markdown table rendering and any
 * place that needs to align text to a target column width.
 *
 * The displayWidth parameter is computed by the caller (typically
 * stringWidth on stripAnsi'd text) so ANSI codes in `content` don't
 * affect padding. Wrong alignment math = misaligned columns in
 * rendered tables.
 */
import { describe, expect, test } from 'bun:test'
import { padAligned } from '../markdown.js'

describe('padAligned — left/default alignment', () => {
  test('default (no align) pads on the right', () => {
    expect(padAligned('hi', 2, 10, undefined)).toBe('hi        ')
  })

  test('left align same as default', () => {
    expect(padAligned('hi', 2, 10, 'left')).toBe('hi        ')
  })

  test('null align same as default', () => {
    expect(padAligned('hi', 2, 10, null)).toBe('hi        ')
  })

  test('content already at target: no padding', () => {
    expect(padAligned('hello', 5, 5, 'left')).toBe('hello')
  })

  test('content longer than target: NO truncation, no negative padding', () => {
    // Math.max(0, targetWidth - displayWidth) → 0 padding when over.
    expect(padAligned('hello world', 11, 5, 'left')).toBe('hello world')
  })
})

describe('padAligned — right alignment', () => {
  test('right pads on the left', () => {
    expect(padAligned('hi', 2, 10, 'right')).toBe('        hi')
  })

  test('right at target: no padding', () => {
    expect(padAligned('hi', 2, 2, 'right')).toBe('hi')
  })

  test('right with overlong content: no truncation', () => {
    expect(padAligned('hello world', 11, 5, 'right')).toBe('hello world')
  })
})

describe('padAligned — center alignment', () => {
  test('even padding: split equally', () => {
    // 10 - 2 = 8 padding; 4 left + 4 right
    expect(padAligned('hi', 2, 10, 'center')).toBe('    hi    ')
  })

  test('odd padding: left gets floor, right gets ceiling', () => {
    // 11 - 2 = 9 padding; floor(9/2)=4 left + 5 right
    expect(padAligned('hi', 2, 11, 'center')).toBe('    hi     ')
  })

  test('1-char padding: left 0, right 1', () => {
    expect(padAligned('hi', 2, 3, 'center')).toBe('hi ')
  })

  test('center at target: no padding', () => {
    expect(padAligned('hi', 2, 2, 'center')).toBe('hi')
  })

  test('center with overlong content: no truncation', () => {
    expect(padAligned('hello world', 11, 5, 'center')).toBe('hello world')
  })
})

describe('padAligned — displayWidth ≠ content.length cases', () => {
  test('caller-supplied displayWidth overrides .length', () => {
    // For ANSI-coded content, caller passes the visible width.
    // Here we pass content with no ANSI but custom displayWidth.
    // The function only uses displayWidth for padding math.
    const result = padAligned('hi', 5, 10, 'left')
    // Padding = max(0, 10 - 5) = 5 (NOT 10 - 2 = 8).
    expect(result).toBe('hi     ') // 'hi' + 5 spaces = 7 chars total
  })

  test('CJK content: displayWidth=4 for 2 chars (each 2 cells wide)', () => {
    // The caller computes 中文 takes 4 display columns; padAligned uses
    // that for math, not the JS string length (2).
    const result = padAligned('中文', 4, 10, 'left')
    expect(result).toBe('中文      ') // '中文' + 6 spaces
    // Total visible width = 4 + 6 = 10 ✓
  })
})

describe('padAligned — empty content', () => {
  test('empty content with target 0: empty', () => {
    expect(padAligned('', 0, 0, 'left')).toBe('')
  })

  test('empty content with target 5: 5 spaces', () => {
    expect(padAligned('', 0, 5, 'left')).toBe('     ')
  })

  test('empty content center: spaces split', () => {
    // floor(5/2)=2 left + 3 right
    expect(padAligned('', 0, 5, 'center')).toBe('     ')
  })
})
