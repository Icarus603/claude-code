/**
 * Tests for intl helpers — wrap Intl.Segmenter / Intl.RelativeTimeFormat
 * with lazy-cached instances. These are pure given a working ICU build,
 * so we can probe grapheme cluster handling deterministically.
 *
 * Used by: cursor positioning, vim operators, transcript trimming.
 * Wrong grapheme boundary = backspace eats half a CJK char or a
 * combining-mark family (👨‍👩‍👧‍👦 broken into pieces).
 */
import { describe, expect, test } from 'bun:test'
import {
  firstGrapheme,
  getGraphemeSegmenter,
  getRelativeTimeFormat,
  getSystemLocaleLanguage,
  getTimeZone,
  getWordSegmenter,
  lastGrapheme,
} from '../utils/intl.js'

describe('firstGrapheme', () => {
  test('empty string → empty string', () => {
    expect(firstGrapheme('')).toBe('')
  })

  test('ASCII single char', () => {
    expect(firstGrapheme('a')).toBe('a')
  })

  test('multi-char ASCII string returns just first char', () => {
    expect(firstGrapheme('hello')).toBe('h')
  })

  test('CJK character (1 grapheme = 1 char)', () => {
    expect(firstGrapheme('中文')).toBe('中')
  })

  test('emoji ZWJ sequence stays whole', () => {
    // 👨‍👩‍👧‍👦 is one grapheme but multiple code points.
    expect(firstGrapheme('👨‍👩‍👧‍👦 family')).toBe('👨‍👩‍👧‍👦')
  })

  test('combining marks bind to base char', () => {
    // 'é' as e + combining acute (U+0065 U+0301) = 1 grapheme
    const composed = 'e\u0301llo'
    expect(firstGrapheme(composed)).toBe('e\u0301')
  })

  test('regional indicator pair (flag emoji) stays whole', () => {
    // 🇺🇸 = U+1F1FA U+1F1F8 (two regional indicators, one grapheme).
    expect(firstGrapheme('🇺🇸 hello')).toBe('🇺🇸')
  })

  test('newline is one grapheme', () => {
    expect(firstGrapheme('\n abc')).toBe('\n')
  })

  test('CRLF binds to single grapheme', () => {
    // \r\n is canonical 1 grapheme per UAX #29
    expect(firstGrapheme('\r\nabc')).toBe('\r\n')
  })
})

describe('lastGrapheme', () => {
  test('empty string → empty string', () => {
    expect(lastGrapheme('')).toBe('')
  })

  test('single ASCII char', () => {
    expect(lastGrapheme('a')).toBe('a')
  })

  test('returns last char of multi-char string', () => {
    expect(lastGrapheme('hello')).toBe('o')
  })

  test('CJK char at end', () => {
    expect(lastGrapheme('hello中')).toBe('中')
  })

  test('emoji ZWJ sequence at end stays whole', () => {
    expect(lastGrapheme('family: 👨‍👩‍👧‍👦')).toBe('👨‍👩‍👧‍👦')
  })

  test('regional indicator pair at end', () => {
    expect(lastGrapheme('flag: 🇯🇵')).toBe('🇯🇵')
  })

  test('combining mark at end binds to base', () => {
    expect(lastGrapheme('foo\u0301')).toBe('o\u0301')
  })
})

describe('getGraphemeSegmenter', () => {
  test('returns a singleton (caching)', () => {
    const a = getGraphemeSegmenter()
    const b = getGraphemeSegmenter()
    expect(a).toBe(b)
  })

  test('produces grapheme granularity (not codepoint)', () => {
    const seg = getGraphemeSegmenter()
    const arr = Array.from(seg.segment('a👨‍👩‍👧‍👦b'))
    // 3 segments: 'a', the family ZWJ sequence, 'b'
    expect(arr).toHaveLength(3)
    expect(arr[1]?.segment).toBe('👨‍👩‍👧‍👦')
  })
})

describe('getWordSegmenter', () => {
  test('returns a singleton', () => {
    const a = getWordSegmenter()
    const b = getWordSegmenter()
    expect(a).toBe(b)
  })

  test('segments words with isWordLike property', () => {
    const seg = getWordSegmenter()
    const arr = Array.from(seg.segment('hello world'))
    // At minimum: 'hello', ' ', 'world' (or similar). Word segments
    // have isWordLike=true; whitespace doesn't.
    const wordsOnly = arr.filter(s => s.isWordLike)
    expect(wordsOnly.map(s => s.segment)).toEqual(['hello', 'world'])
  })
})

describe('getRelativeTimeFormat', () => {
  test('formats with narrow style', () => {
    const rtf = getRelativeTimeFormat('narrow', 'always')
    // rtf.format(-3, 'day') in en narrow is something like "3d ago" or
    // "3d. ago". The exact wording is locale-data-dependent, so we
    // just lock that it returns a non-empty string.
    expect(rtf.format(-3, 'day').length).toBeGreaterThan(0)
  })

  test('caches by style:numeric key', () => {
    const a = getRelativeTimeFormat('long', 'auto')
    const b = getRelativeTimeFormat('long', 'auto')
    expect(a).toBe(b)
  })

  test('different styles get different instances', () => {
    const narrow = getRelativeTimeFormat('narrow', 'always')
    const longRtf = getRelativeTimeFormat('long', 'always')
    expect(narrow).not.toBe(longRtf)
  })

  test('different numeric flag gets different instance', () => {
    const always = getRelativeTimeFormat('long', 'always')
    const auto = getRelativeTimeFormat('long', 'auto')
    expect(always).not.toBe(auto)
  })
})

describe('getTimeZone', () => {
  test('returns a non-empty IANA timezone string', () => {
    const tz = getTimeZone()
    expect(typeof tz).toBe('string')
    expect(tz.length).toBeGreaterThan(0)
  })

  test('returns the same value on subsequent calls (cached)', () => {
    expect(getTimeZone()).toBe(getTimeZone())
  })
})

describe('getSystemLocaleLanguage', () => {
  test('returns a string or undefined (never null)', () => {
    const lang = getSystemLocaleLanguage()
    expect(lang === undefined || typeof lang === 'string').toBe(true)
    // null is the "uninitialised" sentinel — caller must NEVER see it.
    expect(lang).not.toBeNull()
  })

  test('returns same value on repeat calls (cached)', () => {
    const a = getSystemLocaleLanguage()
    const b = getSystemLocaleLanguage()
    expect(a).toBe(b)
  })

  test('if defined: lowercased language subtag (no region)', () => {
    const lang = getSystemLocaleLanguage()
    if (lang) {
      expect(lang).toBe(lang.toLowerCase())
      // Should not contain '-' (e.g. 'en' not 'en-US').
      expect(lang).not.toContain('-')
    }
  })
})
