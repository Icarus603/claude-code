import { describe, expect, test } from 'bun:test'
import { ndjsonSafeStringify } from '../ndjsonSafeStringify.js'

describe('ndjsonSafeStringify — basic JSON', () => {
  test('stringifies object', () => {
    expect(ndjsonSafeStringify({ a: 1 })).toBe('{"a":1}')
  })

  test('stringifies array', () => {
    expect(ndjsonSafeStringify([1, 2, 3])).toBe('[1,2,3]')
  })

  test('stringifies primitive', () => {
    expect(ndjsonSafeStringify(42)).toBe('42')
    expect(ndjsonSafeStringify('hi')).toBe('"hi"')
    expect(ndjsonSafeStringify(null)).toBe('null')
    expect(ndjsonSafeStringify(true)).toBe('true')
  })
})

describe('ndjsonSafeStringify — line terminator escaping', () => {
  // Critical contract: U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR
  // are valid raw JSON chars (per ECMA-404) but ARE line terminators per
  // ECMA-262 §11.3. A receiver that splits on JS line terminators would
  // cut the JSON mid-string. Without this escape, NDJSON streams silently
  // drop messages containing these chars (gh-28405).

  test('escapes U+2028 LINE SEPARATOR to \\u2028', () => {
    const result = ndjsonSafeStringify({ text: 'line1\u2028line2' })
    expect(result).toContain('\\u2028')
    expect(result).not.toContain('\u2028') // raw must be gone
  })

  test('escapes U+2029 PARAGRAPH SEPARATOR to \\u2029', () => {
    const result = ndjsonSafeStringify({ text: 'p1\u2029p2' })
    expect(result).toContain('\\u2029')
    expect(result).not.toContain('\u2029')
  })

  test('escapes BOTH U+2028 and U+2029 in same string', () => {
    const result = ndjsonSafeStringify({ text: 'a\u2028b\u2029c' })
    expect(result).toContain('\\u2028')
    expect(result).toContain('\\u2029')
  })

  test('escapes multiple occurrences of U+2028', () => {
    const result = ndjsonSafeStringify({ text: '\u2028a\u2028b\u2028' })
    const matches = result.match(/\\u2028/g)
    expect(matches?.length).toBe(3)
  })

  test('escaped output round-trips through JSON.parse to ORIGINAL string', () => {
    // The whole point: \\uXXXX is equivalent JSON. Receivers that DO
    // parse correctly get the original Unicode chars back.
    const original = { text: 'a\u2028b\u2029c' }
    const escaped = ndjsonSafeStringify(original)
    const parsed = JSON.parse(escaped) as typeof original
    expect(parsed.text).toBe('a\u2028b\u2029c')
  })

  test('does NOT escape regular newlines (\\n) — those are inside JSON strings already', () => {
    // \n is escaped to \\n by JSON.stringify itself. The function only
    // adds U+2028/U+2029 handling. Verify we don't accidentally
    // affect regular newlines.
    const result = ndjsonSafeStringify({ text: 'a\nb' })
    expect(result).toContain('\\n')
    expect(result).not.toContain('\u2028')
    expect(result).not.toContain('\u2029')
  })

  test('output never contains a raw line terminator (single-line guarantee)', () => {
    // Critical invariant: NDJSON requires one message per line.
    const result = ndjsonSafeStringify({
      a: 'a\u2028b\u2029c',
      b: 'd\u2028e',
    })
    expect(result).not.toContain('\u2028')
    expect(result).not.toContain('\u2029')
    // Also no raw \n / \r — those would already be escaped by
    // JSON.stringify, but verify.
    expect(result).not.toContain('\n')
    expect(result).not.toContain('\r')
  })
})

describe('ndjsonSafeStringify — non-affected unicode', () => {
  test('preserves emoji', () => {
    const result = ndjsonSafeStringify({ text: '👋' })
    const parsed = JSON.parse(result) as { text: string }
    expect(parsed.text).toBe('👋')
  })

  test('preserves Chinese chars', () => {
    const result = ndjsonSafeStringify({ text: '世界' })
    const parsed = JSON.parse(result) as { text: string }
    expect(parsed.text).toBe('世界')
  })

  test('preserves zero-width joiner U+200D (NOT a line terminator)', () => {
    // ZWJ is U+200D, not in {U+2028, U+2029}. Must pass through.
    const result = ndjsonSafeStringify({ text: 'a\u200Db' })
    const parsed = JSON.parse(result) as { text: string }
    expect(parsed.text).toBe('a\u200Db')
  })
})
