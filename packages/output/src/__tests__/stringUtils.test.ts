/**
 * Tests for output/stringUtils — small utilities used across the
 * output rendering layer (markdown, capture, formatters).
 */
import { describe, expect, test } from 'bun:test'
import {
  capitalize,
  countCharInString,
  escapeRegExp,
  firstLineOf,
  normalizeFullWidthDigits,
  normalizeFullWidthSpace,
  plural,
} from '../utils/stringUtils.js'

describe('escapeRegExp', () => {
  test('plain alphanumeric unchanged', () => {
    expect(escapeRegExp('hello123')).toBe('hello123')
  })

  test('escapes regex special chars', () => {
    expect(escapeRegExp('a.b*c+d?')).toBe('a\\.b\\*c\\+d\\?')
  })

  test('escapes brackets', () => {
    expect(escapeRegExp('[abc]')).toBe('\\[abc\\]')
    expect(escapeRegExp('(x)')).toBe('\\(x\\)')
    expect(escapeRegExp('{a,b}')).toBe('\\{a,b\\}')
  })

  test('escapes anchors', () => {
    expect(escapeRegExp('^start$')).toBe('\\^start\\$')
  })

  test('escapes pipe and backslash', () => {
    expect(escapeRegExp('a|b\\c')).toBe('a\\|b\\\\c')
  })

  test('empty string → empty', () => {
    expect(escapeRegExp('')).toBe('')
  })

  test('escaped output safe to use in RegExp constructor', () => {
    const escaped = escapeRegExp('foo.bar*baz')
    const re = new RegExp(escaped)
    expect(re.test('foo.bar*baz')).toBe(true)
    expect(re.test('fooXbarYbaz')).toBe(false)
  })
})

describe('capitalize', () => {
  test('uppercases first char only', () => {
    expect(capitalize('fooBar')).toBe('FooBar')
  })

  test('does NOT lowercase rest (per docstring)', () => {
    // Different from lodash.capitalize.
    expect(capitalize('hello WORLD')).toBe('Hello WORLD')
  })

  test('empty string → empty', () => {
    expect(capitalize('')).toBe('')
  })

  test('single char uppercased', () => {
    expect(capitalize('a')).toBe('A')
  })

  test('non-letter first char unchanged', () => {
    expect(capitalize('1abc')).toBe('1abc')
    expect(capitalize('!hello')).toBe('!hello')
  })

  test('CJK first char unchanged (no upper case form)', () => {
    expect(capitalize('中文')).toBe('中文')
  })
})

describe('plural', () => {
  test('n=1 → singular', () => {
    expect(plural(1, 'file')).toBe('file')
  })

  test('n=0 → plural', () => {
    expect(plural(0, 'file')).toBe('files')
  })

  test('n>1 → plural', () => {
    expect(plural(3, 'file')).toBe('files')
  })

  test('custom plural form', () => {
    expect(plural(2, 'entry', 'entries')).toBe('entries')
  })

  test('custom plural with n=1 still returns singular', () => {
    expect(plural(1, 'entry', 'entries')).toBe('entry')
  })

  test('negative n → plural (anything-not-1 rule)', () => {
    expect(plural(-1, 'file')).toBe('files')
  })
})

describe('firstLineOf', () => {
  test('single line returns whole string', () => {
    expect(firstLineOf('hello world')).toBe('hello world')
  })

  test('multi-line returns first line only', () => {
    expect(firstLineOf('first\nsecond\nthird')).toBe('first')
  })

  test('empty string → empty', () => {
    expect(firstLineOf('')).toBe('')
  })

  test('newline at start → empty first line', () => {
    expect(firstLineOf('\nrest')).toBe('')
  })

  test('CR-only line endings NOT split (only \\n)', () => {
    // Documented: only \n triggers split. CRLF leaves \r in the
    // output (it's the last char of the first line).
    expect(firstLineOf('first\rsecond')).toBe('first\rsecond')
  })

  test('CRLF line endings: first line includes the \\r', () => {
    expect(firstLineOf('first\r\nsecond')).toBe('first\r')
  })
})

describe('countCharInString', () => {
  test('counts occurrences of single char', () => {
    expect(countCharInString('aaaa', 'a')).toBe(4)
  })

  test('zero occurrences', () => {
    expect(countCharInString('hello', 'z')).toBe(0)
  })

  test('multi-char needle', () => {
    expect(countCharInString('hellohello', 'lo')).toBe(2)
  })

  test('empty haystack', () => {
    expect(countCharInString('', 'x')).toBe(0)
  })

  test('start offset skips earlier matches', () => {
    expect(countCharInString('aaaa', 'a', 2)).toBe(2)
  })

  test('Buffer also works (structurally-typed input)', () => {
    const buf = Buffer.from('hello')
    expect(countCharInString(buf, 'l')).toBe(2)
  })

  test('overlapping multi-char needles count once each', () => {
    // 'aaaa' has 'aa' at positions 0, 1, 2, 3. The implementation
    // jumps by i+1 each time, so it finds 'aa' at 0, 1, 2, 3 = 3 hits.
    // Documented as "indexOf jumps" — 3 instead of 4.
    expect(countCharInString('aaaa', 'aa')).toBe(3)
  })
})

describe('normalizeFullWidthDigits', () => {
  test('full-width digits converted to half-width', () => {
    // ０ = U+FF10, equivalent to '0' (U+0030). Offset 0xFEE0.
    expect(normalizeFullWidthDigits('０１２３４５６７８９')).toBe(
      '0123456789',
    )
  })

  test('mixed full + half preserves half', () => {
    expect(normalizeFullWidthDigits('１2３')).toBe('123')
  })

  test('non-digit full-width chars unchanged', () => {
    // ｆ ｏ ｏ are full-width letters, NOT digits.
    expect(normalizeFullWidthDigits('ｆｏｏ')).toBe('ｆｏｏ')
  })

  test('empty string → empty', () => {
    expect(normalizeFullWidthDigits('')).toBe('')
  })
})

describe('normalizeFullWidthSpace', () => {
  test('full-width space → half-width space', () => {
    // U+3000 → U+0020
    expect(normalizeFullWidthSpace('a\u3000b')).toBe('a b')
  })

  test('multiple full-width spaces all converted', () => {
    expect(normalizeFullWidthSpace('a\u3000\u3000b')).toBe('a  b')
  })

  test('regular space unchanged', () => {
    expect(normalizeFullWidthSpace('a b')).toBe('a b')
  })

  test('empty string → empty', () => {
    expect(normalizeFullWidthSpace('')).toBe('')
  })
})
