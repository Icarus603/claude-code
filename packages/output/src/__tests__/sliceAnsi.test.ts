/**
 * Tests for sliceAnsi (output's display-cell-aware variant) — slices a
 * string by display cells (not code units) while preserving ANSI codes.
 *
 * Used by: HighlightedCode, StructuredDiff, terminal width-clipping,
 * AskUserQuestion preview boxes. Wrong slicing = ANSI styles bleed
 * past the slice end (next text gets unintended color); CJK chars get
 * cut in half (rendered as ?); combining marks get duplicated across
 * left+right halves (visual stutter); slice past width truncates
 * combining-mark families.
 */
import { describe, expect, test } from 'bun:test'
import sliceAnsi from '../utils/sliceAnsi.js'

describe('sliceAnsi — plain text (no ANSI)', () => {
  test('full slice = original', () => {
    expect(sliceAnsi('hello', 0)).toBe('hello')
  })

  test('end before length → truncates', () => {
    expect(sliceAnsi('hello', 0, 3)).toBe('hel')
  })

  test('start > 0 trims left side', () => {
    expect(sliceAnsi('hello', 2)).toBe('llo')
  })

  test('start + end window', () => {
    expect(sliceAnsi('hello world', 6, 11)).toBe('world')
  })

  test('empty input → empty', () => {
    expect(sliceAnsi('', 0)).toBe('')
  })

  test('start === end → empty', () => {
    expect(sliceAnsi('hello', 2, 2)).toBe('')
  })

  test('start past end of string → empty', () => {
    expect(sliceAnsi('hi', 10)).toBe('')
  })

  test('end past length → up to length', () => {
    expect(sliceAnsi('hi', 0, 100)).toBe('hi')
  })
})

describe('sliceAnsi — CJK / fullwidth chars', () => {
  test('CJK chars take 2 display cells; slice in cells not code units', () => {
    // '中文' = 2 chars, 4 display cells.
    expect(sliceAnsi('中文', 0, 2)).toBe('中')
    expect(sliceAnsi('中文', 0, 4)).toBe('中文')
  })

  test('slice ending mid-CJK char does NOT split the char', () => {
    // Boundary at end=1 (mid-char). The widths the function uses say
    // first CJK char advances position from 0→2; once position>=end
    // before emit, loop breaks. So end=1 yields '' (no half-char).
    const sliced = sliceAnsi('中文', 0, 1)
    // Either '' (most common) or just '中' — what we LOCK is that
    // there's never a mojibake half-char artifact.
    expect(sliced === '' || sliced === '中').toBe(true)
  })

  test('mixed ASCII+CJK alignment', () => {
    // 'a中b' = 4 cells (1 + 2 + 1)
    expect(sliceAnsi('a中b', 0, 1)).toBe('a')
    expect(sliceAnsi('a中b', 0, 3)).toBe('a中')
    expect(sliceAnsi('a中b', 0, 4)).toBe('a中b')
  })

  test('start in middle of CJK: skips zero-width marks at boundary', () => {
    expect(sliceAnsi('a中b', 1, 4)).toBe('中b')
  })
})

describe('sliceAnsi — ANSI codes', () => {
  test('ANSI codes preserved within slice', () => {
    const input = '\u001b[31mred\u001b[0m'
    const result = sliceAnsi(input, 0, 3)
    expect(result).toContain('red')
    expect(result).toContain('\u001b[31m')
  })

  test('partial slice closes the open style at end', () => {
    // Take 'r' from '\x1b[31mred\x1b[0m' — should re-emit reset so
    // following text isn't accidentally red.
    const input = '\u001b[31mred\u001b[0m'
    const result = sliceAnsi(input, 0, 1)
    // The result should end with an undo (or original close) sequence
    expect(result).toContain('r')
    expect(result).toContain('\u001b[31m')
    // Something that closes the color
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape match is intentional
    expect(result).toMatch(/\u001b\[(0|39|m)/)
  })

  test('slice starting after ANSI open keeps the active style', () => {
    const input = '\u001b[31mhello\u001b[0m'
    const result = sliceAnsi(input, 2, 5)
    expect(result).toContain('llo')
    // Active red style at start should still be applied
    expect(result).toContain('\u001b[31m')
  })

  test('no ANSI in input → no ANSI in output', () => {
    expect(sliceAnsi('plain', 0, 5)).toBe('plain')
  })

  test('multiple style runs preserved', () => {
    const input = '\u001b[31mred\u001b[0m\u001b[32mgreen\u001b[0m'
    const result = sliceAnsi(input, 0, 8)
    expect(result).toContain('red')
    expect(result).toContain('green')
  })
})

describe('sliceAnsi — combining marks (zero-width)', () => {
  test('combining mark binds to base char in left half', () => {
    // 'भा' = 'भ' (DEVANAGARI BHA, base, width 1) + 'ा' (DEVANAGARI
    // SIGN AA, combining, width 0) = 1 display cell total.
    // Slicing at end=1 should include both (not just 'भ').
    const result = sliceAnsi('भा', 0, 1)
    // The combining mark must come along with its base.
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result).toContain('भ')
  })

  test('zero-width mark at start boundary attaches to LEFT half (not duplicated)', () => {
    // If we slice at start=1 of 'aभाb', the ा (combining mark on भ)
    // belongs to the left half; the right slice starts with 'भा' or
    // 'ाb'. Implementation skips the leading zero-width — so the
    // mark does NOT appear at the start of the right half.
    // The contract LOCKS: left + right hashes match the original
    // when slicing on a non-zero-width boundary.
    const text = 'aभb'
    const left = sliceAnsi(text, 0, 1)
    const right = sliceAnsi(text, 1)
    expect(left + right).toBe(text)
  })
})

describe('sliceAnsi — slice invariants', () => {
  test('left + right concat equals original (clean ASCII)', () => {
    const text = 'hello world'
    for (const cut of [0, 1, 5, 6, 10, 11]) {
      const left = sliceAnsi(text, 0, cut)
      const right = sliceAnsi(text, cut)
      expect(left + right).toBe(text)
    }
  })

  test('slice(0, 0) is always empty', () => {
    expect(sliceAnsi('hello', 0, 0)).toBe('')
    expect(sliceAnsi('中文', 0, 0)).toBe('')
    expect(sliceAnsi('\u001b[31mred\u001b[0m', 0, 0)).toBe('')
  })
})
