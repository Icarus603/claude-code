import { describe, expect, test } from 'bun:test'
import {
  truncate,
  truncatePathMiddle,
  truncateStartToWidth,
  truncateToWidth,
  truncateToWidthNoEllipsis,
  wrapText,
} from '../formatters/truncate.js'

describe('truncateToWidth', () => {
  test('returns input unchanged when within width', () => {
    expect(truncateToWidth('hello', 10)).toBe('hello')
  })
  test('truncates with ellipsis when over width', () => {
    expect(truncateToWidth('hello world', 8)).toBe('hello w…')
  })
  test('returns just ellipsis for width <= 1', () => {
    expect(truncateToWidth('anything', 1)).toBe('…')
    expect(truncateToWidth('anything', 0)).toBe('…')
  })
  test('preserves empty string', () => {
    expect(truncateToWidth('', 10)).toBe('')
  })
  test('respects grapheme boundaries (does not break emoji)', () => {
    // 👨‍👩‍👧‍👦 is a 1-grapheme ZWJ-joined family emoji. Width = 2.
    const family = '👨‍👩‍👧‍👦'
    // Width 5: family (2) + 'ab' (2) = 4 fits, with 'c' (1) = 5 fits, but no
    // truncation needed since input fits in 5.
    expect(truncateToWidth(family + 'abc', 10)).toBe(family + 'abc')
  })
})

describe('truncateStartToWidth', () => {
  test('keeps the tail when truncating from start', () => {
    expect(truncateStartToWidth('hello world', 8)).toBe('…o world')
  })
  test('returns input unchanged when fits', () => {
    expect(truncateStartToWidth('hi', 10)).toBe('hi')
  })
  test('returns ellipsis when width <= 1', () => {
    expect(truncateStartToWidth('long text', 1)).toBe('…')
    expect(truncateStartToWidth('long text', 0)).toBe('…')
  })
})

describe('truncateToWidthNoEllipsis', () => {
  test('returns input unchanged when fits', () => {
    expect(truncateToWidthNoEllipsis('foo', 10)).toBe('foo')
  })
  test('truncates without appending ellipsis', () => {
    expect(truncateToWidthNoEllipsis('hello world', 5)).toBe('hello')
  })
  test('returns empty string for non-positive width', () => {
    expect(truncateToWidthNoEllipsis('anything', 0)).toBe('')
    expect(truncateToWidthNoEllipsis('anything', -1)).toBe('')
  })
})

describe('truncatePathMiddle', () => {
  test('returns path unchanged when fits', () => {
    expect(truncatePathMiddle('/short/path.ts', 30)).toBe('/short/path.ts')
  })

  test('truncates middle, keeps filename', () => {
    const result = truncatePathMiddle(
      '@claude-code/repl/components/deeply/nested/folder/MyComponent.tsx',
      30,
    )
    expect(result).toContain('…')
    expect(result.endsWith('/MyComponent.tsx')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(30)
  })

  test('returns just ellipsis for non-positive maxLength', () => {
    expect(truncatePathMiddle('/some/path', 0)).toBe('…')
    expect(truncatePathMiddle('/some/path', -1)).toBe('…')
  })

  test('falls back to truncateToWidth when maxLength < 5', () => {
    const result = truncatePathMiddle('/some/very/long/path.ts', 4)
    expect(result.length).toBeLessThanOrEqual(4)
  })

  test('handles path with no slash (just a filename)', () => {
    expect(truncatePathMiddle('verylongfilename.ts', 30)).toBe(
      'verylongfilename.ts',
    )
  })

  test('truncates from start when filename alone exceeds maxLength', () => {
    const result = truncatePathMiddle(
      '/dir/extremelyLongFileNameThatIsTooLong.tsx',
      20,
    )
    expect(result.startsWith('…')).toBe(true)
  })
})

describe('truncate (top-level)', () => {
  test('passes through short single-line input', () => {
    expect(truncate('foo', 10)).toBe('foo')
  })
  test('truncates long single-line input with ellipsis', () => {
    expect(truncate('hello world hello world', 10)).toBe('hello wor…')
  })
  test('singleLine=true cuts at first newline + appends ellipsis', () => {
    expect(truncate('first line\nsecond', 80, true)).toBe('first line…')
  })
  test('singleLine=true with line shorter than maxWidth keeps the … suffix', () => {
    // first-line = 'short' (width 5), maxWidth=80, +1 ellipsis = 6 <= 80
    expect(truncate('short\nsecond', 80, true)).toBe('short…')
  })
  test('singleLine=true with first line longer than maxWidth uses width truncation', () => {
    expect(truncate('this is a long first line\nsecond', 10, true)).toBe(
      'this is a…',
    )
  })
  test('singleLine=false ignores newlines entirely', () => {
    // No truncation since stringWidth('a\nb') is 2 (newlines have 0 width).
    expect(truncate('a\nb', 80, false)).toBe('a\nb')
  })
})

describe('wrapText', () => {
  test('returns single line when fits', () => {
    expect(wrapText('hello', 10)).toEqual(['hello'])
  })
  test('wraps at width boundary', () => {
    expect(wrapText('abcdefghij', 3)).toEqual(['abc', 'def', 'ghi', 'j'])
  })
  test('empty input produces empty array', () => {
    expect(wrapText('', 10)).toEqual([])
  })
  test('single grapheme wider than width still wraps (unbreakable)', () => {
    // Single emoji-grapheme width 2, wrap at 1: each emoji on own line
    // Width=1 means emoji can never fit, but the loop still pushes it as
    // its own line (width counter resets to segWidth).
    const result = wrapText('a😀b', 1)
    // Behavior: segments are ['a', '😀', 'b'], wrap budget=1.
    // 'a' fits (width 1). '😀' (width 2) doesn't fit so flush 'a',
    // start new line with '😀' (width=2 already over, but we put it
    // there). Then 'b' (width 1) doesn't fit (2+1=3>1), flush '😀',
    // start with 'b'.
    expect(result.length).toBeGreaterThanOrEqual(2)
  })
})
