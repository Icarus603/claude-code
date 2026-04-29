import { describe, expect, test } from 'bun:test'
import { parseDataUri } from '../utils.js'

describe('parseDataUri', () => {
  test('parses well-formed image data URI', () => {
    // Tiny 1x1 PNG (valid base64)
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAAxJREFUeF5jYGAAAAADAAFEpATvAAAAAElFTkSuQmCC'
    const r = parseDataUri(`data:image/png;base64,${png}`)
    expect(r).toEqual({ mediaType: 'image/png', data: png })
  })

  test('accepts base64 with = padding', () => {
    const r = parseDataUri('data:image/png;base64,dGVzdA==')
    expect(r?.data).toBe('dGVzdA==')
  })

  test('accepts base64 with single = padding', () => {
    const r = parseDataUri('data:text/plain;base64,YWJj=')
    expect(r?.data).toBe('YWJj=')
  })

  test('strips outer whitespace', () => {
    const r = parseDataUri('   data:image/png;base64,YWJj   ')
    expect(r?.data).toBe('YWJj')
  })

  test('returns null for non-data URI', () => {
    expect(parseDataUri('https://example.com')).toBeNull()
    expect(parseDataUri('foo bar')).toBeNull()
    expect(parseDataUri('')).toBeNull()
  })

  test('returns null when base64 marker absent', () => {
    expect(parseDataUri('data:image/png,YWJj')).toBeNull()
  })

  // Regression: bug #13 (2026-04-29) — DATA_URI_RE was `(.+)` so any chars
  // matched. Buffer.from(<bad>, 'base64') silently produced garbage,
  // corrupting downstream image processing.
  test('rejects payload with non-base64 chars (regression: 2026-04-29 #13)', () => {
    // Spaces, hash, exclamation are NOT base64 alphabet
    expect(parseDataUri('data:image/png;base64,abc!def')).toBeNull()
    expect(parseDataUri('data:image/png;base64,abc def')).toBeNull()
    expect(parseDataUri('data:image/png;base64,abc#def')).toBeNull()
    expect(parseDataUri('data:image/png;base64,abc<def')).toBeNull()
  })

  test('rejects more-than-2 = padding', () => {
    expect(parseDataUri('data:image/png;base64,YWJj===')).toBeNull()
    expect(parseDataUri('data:image/png;base64,YWJj====')).toBeNull()
  })

  test('rejects = in middle (only trailing padding allowed)', () => {
    expect(parseDataUri('data:image/png;base64,YW=Jj')).toBeNull()
  })

  test('captures full mediaType including subtype', () => {
    const r = parseDataUri('data:application/json;base64,e30=')
    expect(r?.mediaType).toBe('application/json')
  })
})
