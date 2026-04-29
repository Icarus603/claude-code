/**
 * Tests for FileEditTool/utils.ts pure helpers.
 *
 * normalizeQuotes / findActualString are the curly-quote tolerance layer
 * for FileEdit — without them, a file with typographic quotes (`"foo"`)
 * never matches a model-generated old_string with straight quotes,
 * and the edit fails with "string not found".
 *
 * stripTrailingWhitespace is the line-ending-preserving whitespace
 * stripper used during file writes — wrong line-ending handling
 * silently corrupts CRLF files on Windows.
 *
 * preserveQuoteStyle keeps file typography consistent — without it,
 * editing a curly-quote file with a model-generated edit silently
 * downgrades all the file's quotes to straight ones.
 */
import { describe, expect, test } from 'bun:test'
import {
  findActualString,
  LEFT_DOUBLE_CURLY_QUOTE,
  LEFT_SINGLE_CURLY_QUOTE,
  normalizeQuotes,
  preserveQuoteStyle,
  RIGHT_DOUBLE_CURLY_QUOTE,
  RIGHT_SINGLE_CURLY_QUOTE,
  stripTrailingWhitespace,
} from '../tools/FileEditTool/utils.js'

describe('normalizeQuotes', () => {
  test('left single curly → straight single', () => {
    expect(normalizeQuotes(`${LEFT_SINGLE_CURLY_QUOTE}foo`)).toBe("'foo")
  })

  test('right single curly → straight single', () => {
    expect(normalizeQuotes(`foo${RIGHT_SINGLE_CURLY_QUOTE}`)).toBe("foo'")
  })

  test('left double curly → straight double', () => {
    expect(normalizeQuotes(`${LEFT_DOUBLE_CURLY_QUOTE}foo`)).toBe('"foo')
  })

  test('right double curly → straight double', () => {
    expect(normalizeQuotes(`foo${RIGHT_DOUBLE_CURLY_QUOTE}`)).toBe('foo"')
  })

  test('mixed curlies in one string all normalized', () => {
    const s = `${LEFT_DOUBLE_CURLY_QUOTE}hello${RIGHT_DOUBLE_CURLY_QUOTE} ${LEFT_SINGLE_CURLY_QUOTE}world${RIGHT_SINGLE_CURLY_QUOTE}`
    expect(normalizeQuotes(s)).toBe(`"hello" 'world'`)
  })

  test('already-straight quotes unchanged', () => {
    expect(normalizeQuotes(`"foo" 'bar'`)).toBe(`"foo" 'bar'`)
  })

  test('empty string unchanged', () => {
    expect(normalizeQuotes('')).toBe('')
  })

  test('quotes inside code are also normalized', () => {
    // The function is dumb-replace — it doesn't know about code blocks.
    // This is the documented behavior.
    expect(
      normalizeQuotes(`function f() { return ${LEFT_DOUBLE_CURLY_QUOTE}x${RIGHT_DOUBLE_CURLY_QUOTE} }`),
    ).toBe('function f() { return "x" }')
  })
})

describe('findActualString — exact match path', () => {
  test('exact substring found returns input unchanged', () => {
    expect(findActualString('hello world', 'world')).toBe('world')
  })

  test('substring not present returns null', () => {
    expect(findActualString('hello world', 'xyz')).toBeNull()
  })

  test('empty search string is found at index 0', () => {
    // 'foo'.includes('') is true. Document this — empty searches are
    // technically valid.
    expect(findActualString('foo', '')).toBe('')
  })
})

describe('findActualString — quote-normalization path', () => {
  test('curly-quote file matches straight-quote search', () => {
    // File has typographic quotes; model emits straight quotes.
    const file = `${LEFT_DOUBLE_CURLY_QUOTE}hello${RIGHT_DOUBLE_CURLY_QUOTE}`
    const search = '"hello"'
    const result = findActualString(file, search)
    // The function returns the file's actual bytes (preserving curlies).
    // CRITICAL: returns substring of file content matching SEARCH length.
    expect(result).not.toBeNull()
    expect(result?.length).toBe(search.length)
  })

  test('mixed straight-and-curly: still finds match', () => {
    const file = `say ${LEFT_DOUBLE_CURLY_QUOTE}hi${RIGHT_DOUBLE_CURLY_QUOTE}`
    const search = 'say "hi"'
    expect(findActualString(file, search)).not.toBeNull()
  })

  test('totally different content returns null', () => {
    const file = `${LEFT_DOUBLE_CURLY_QUOTE}foo${RIGHT_DOUBLE_CURLY_QUOTE}`
    expect(findActualString(file, '"bar"')).toBeNull()
  })
})

describe('stripTrailingWhitespace — line-ending preservation', () => {
  test('LF endings preserved', () => {
    expect(stripTrailingWhitespace('a   \nb  \n')).toBe('a\nb\n')
  })

  test('CRLF endings preserved', () => {
    expect(stripTrailingWhitespace('a   \r\nb  \r\n')).toBe('a\r\nb\r\n')
  })

  test('CR-only endings preserved (legacy classic-mac files)', () => {
    expect(stripTrailingWhitespace('a   \rb  \r')).toBe('a\rb\r')
  })

  test('mixed endings: each preserved per-line', () => {
    // CRLF on line 1, LF on line 2.
    expect(stripTrailingWhitespace('a  \r\nb  \nc')).toBe('a\r\nb\nc')
  })

  test('no trailing whitespace: identity', () => {
    expect(stripTrailingWhitespace('a\nb\nc')).toBe('a\nb\nc')
  })

  test('empty string: empty', () => {
    expect(stripTrailingWhitespace('')).toBe('')
  })

  test('all-whitespace lines reduced to empty (line ending preserved)', () => {
    expect(stripTrailingWhitespace('   \n  \n')).toBe('\n\n')
  })

  test('tabs at end stripped same as spaces', () => {
    expect(stripTrailingWhitespace('a\t\t\nb')).toBe('a\nb')
  })

  test('leading whitespace preserved (only trailing stripped)', () => {
    expect(stripTrailingWhitespace('  a  \n  b\n')).toBe('  a\n  b\n')
  })
})

describe('preserveQuoteStyle — no normalization needed', () => {
  test('oldString === actualOldString: returns newString unchanged', () => {
    expect(preserveQuoteStyle('foo', 'foo', 'bar')).toBe('bar')
  })

  test('actualOldString has no curlies: returns newString unchanged', () => {
    expect(preserveQuoteStyle('"foo"', '"foo"', '"bar"')).toBe('"bar"')
  })
})

describe('preserveQuoteStyle — curly typography propagation', () => {
  test('double-quote curly file: newString gets curly doubles', () => {
    const oldStr = '"hello"'
    const actual = `${LEFT_DOUBLE_CURLY_QUOTE}hello${RIGHT_DOUBLE_CURLY_QUOTE}`
    const newStr = '"world"'
    const result = preserveQuoteStyle(oldStr, actual, newStr)
    expect(result).toBe(`${LEFT_DOUBLE_CURLY_QUOTE}world${RIGHT_DOUBLE_CURLY_QUOTE}`)
  })

  test('single-quote curly file: newString gets curly singles', () => {
    const oldStr = "'hi'"
    const actual = `${LEFT_SINGLE_CURLY_QUOTE}hi${RIGHT_SINGLE_CURLY_QUOTE}`
    const newStr = "'bye'"
    const result = preserveQuoteStyle(oldStr, actual, newStr)
    expect(result).toBe(`${LEFT_SINGLE_CURLY_QUOTE}bye${RIGHT_SINGLE_CURLY_QUOTE}`)
  })

  test('mixed curly types in actual: both transformations apply', () => {
    const oldStr = `"foo" 'bar'`
    const actual = `${LEFT_DOUBLE_CURLY_QUOTE}foo${RIGHT_DOUBLE_CURLY_QUOTE} ${LEFT_SINGLE_CURLY_QUOTE}bar${RIGHT_SINGLE_CURLY_QUOTE}`
    const newStr = `"baz" 'qux'`
    const result = preserveQuoteStyle(oldStr, actual, newStr)
    expect(result).toContain(LEFT_DOUBLE_CURLY_QUOTE)
    expect(result).toContain(RIGHT_DOUBLE_CURLY_QUOTE)
    expect(result).toContain(LEFT_SINGLE_CURLY_QUOTE)
    expect(result).toContain(RIGHT_SINGLE_CURLY_QUOTE)
  })
})
