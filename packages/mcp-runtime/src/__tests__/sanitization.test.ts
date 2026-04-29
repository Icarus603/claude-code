import { describe, expect, test } from 'bun:test'
import {
  partiallySanitizeUnicode,
  recursivelySanitizeUnicode,
} from '../sanitization.js'

describe('partiallySanitizeUnicode — passes legitimate content through', () => {
  test('plain ASCII unchanged', () => {
    expect(partiallySanitizeUnicode('hello world')).toBe('hello world')
  })
  test('legitimate non-ASCII preserved', () => {
    expect(partiallySanitizeUnicode('café 中文 🎉')).toBe('café 中文 🎉')
  })
  test('empty string is empty', () => {
    expect(partiallySanitizeUnicode('')).toBe('')
  })
  test('newlines and tabs survive', () => {
    expect(partiallySanitizeUnicode('a\nb\tc')).toBe('a\nb\tc')
  })
})

describe('partiallySanitizeUnicode — strips dangerous categories', () => {
  test('strips zero-width space', () => {
    expect(partiallySanitizeUnicode('hi\u200Bthere')).toBe('hithere')
  })
  test('strips zero-width joiner', () => {
    expect(partiallySanitizeUnicode('a\u200Db')).toBe('ab')
  })
  test('strips byte order mark (BOM)', () => {
    expect(partiallySanitizeUnicode('\uFEFFhello')).toBe('hello')
  })
  test('strips left-to-right mark', () => {
    expect(partiallySanitizeUnicode('a\u200Eb')).toBe('ab')
  })
  test('strips directional override (RTL attack)', () => {
    expect(partiallySanitizeUnicode('a\u202Eb')).toBe('ab')
  })
  test('strips directional isolates', () => {
    expect(partiallySanitizeUnicode('a\u2066b\u2069c')).toBe('abc')
  })
  test('strips private-use BMP characters (Unicode tag attack)', () => {
    // \uE000 is in private-use range
    expect(partiallySanitizeUnicode('safe\uE001hidden')).toBe('safehidden')
  })
})

describe('partiallySanitizeUnicode — NFKC normalization', () => {
  test('decomposes compatibility characters (full-width letters)', () => {
    // ｈｅｌｌｏ (full-width) → hello
    expect(partiallySanitizeUnicode('\uFF48\uFF45\uFF4C\uFF4C\uFF4F')).toBe(
      'hello',
    )
  })
  test('combines diacritics (e + combining acute → é)', () => {
    expect(partiallySanitizeUnicode('e\u0301')).toBe('é')
  })
})

describe('partiallySanitizeUnicode — convergence safety', () => {
  test('idempotent (sanitizing twice equals once)', () => {
    const input = 'safe\u200Bword'
    const once = partiallySanitizeUnicode(input)
    const twice = partiallySanitizeUnicode(once)
    expect(once).toBe(twice)
  })
})

describe('recursivelySanitizeUnicode — strings', () => {
  test('passes through to partiallySanitizeUnicode for strings', () => {
    expect(recursivelySanitizeUnicode('hi\u200Bthere')).toBe('hithere')
  })
  test('returns numbers unchanged', () => {
    expect(recursivelySanitizeUnicode(42)).toBe(42)
  })
  test('returns booleans unchanged', () => {
    expect(recursivelySanitizeUnicode(true)).toBe(true)
  })
  test('returns null unchanged', () => {
    expect(recursivelySanitizeUnicode(null)).toBeNull()
  })
  test('returns undefined unchanged', () => {
    expect(recursivelySanitizeUnicode(undefined)).toBeUndefined()
  })
})

describe('recursivelySanitizeUnicode — arrays', () => {
  test('sanitizes string elements', () => {
    expect(recursivelySanitizeUnicode(['a\u200Bb', 'c'])).toEqual(['ab', 'c'])
  })
  test('preserves non-string elements', () => {
    expect(recursivelySanitizeUnicode([1, 'a\u200Bb', null])).toEqual([
      1,
      'ab',
      null,
    ])
  })
  test('recurses into nested arrays', () => {
    expect(recursivelySanitizeUnicode([['a\u200Bb']])).toEqual([['ab']])
  })
})

describe('recursivelySanitizeUnicode — objects', () => {
  test('sanitizes both keys and values', () => {
    const result = recursivelySanitizeUnicode({
      'key\u200Bone': 'val\u200Bue',
    })
    expect(result).toEqual({ keyone: 'value' })
  })
  test('recurses into nested objects', () => {
    expect(
      recursivelySanitizeUnicode({ outer: { inner: 'a\u200Bb' } }),
    ).toEqual({ outer: { inner: 'ab' } })
  })
  test('preserves primitive values in objects', () => {
    expect(recursivelySanitizeUnicode({ n: 42, b: true })).toEqual({
      n: 42,
      b: true,
    })
  })
})
