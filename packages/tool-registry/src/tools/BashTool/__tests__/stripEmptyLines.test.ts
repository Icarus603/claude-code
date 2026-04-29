import { describe, expect, test } from 'bun:test'
import { isImageOutput, stripEmptyLines } from '../utils.js'

describe('stripEmptyLines', () => {
  test('content with no empty lines unchanged', () => {
    expect(stripEmptyLines('a\nb\nc')).toBe('a\nb\nc')
  })

  test('leading empty lines removed', () => {
    expect(stripEmptyLines('\n\nhello\nworld')).toBe('hello\nworld')
  })

  test('trailing empty lines removed', () => {
    expect(stripEmptyLines('hello\nworld\n\n')).toBe('hello\nworld')
  })

  test('both leading and trailing empty lines removed', () => {
    expect(stripEmptyLines('\n\nhello\nworld\n\n\n')).toBe('hello\nworld')
  })

  test('whitespace-only lines treated as empty (.trim() === "")', () => {
    expect(stripEmptyLines('   \n\nhello\n\t\n')).toBe('hello')
  })

  test('internal empty lines preserved', () => {
    // Critical: only leading/trailing empties stripped. Middle empties stay.
    expect(stripEmptyLines('a\n\nb\n\nc')).toBe('a\n\nb\n\nc')
  })

  test('all empty lines → empty string', () => {
    expect(stripEmptyLines('\n\n\n')).toBe('')
  })

  test('all whitespace lines → empty string', () => {
    expect(stripEmptyLines('   \n\t\n  \n')).toBe('')
  })

  test('empty input → empty string', () => {
    expect(stripEmptyLines('')).toBe('')
  })

  test('single line with content unchanged', () => {
    expect(stripEmptyLines('hello')).toBe('hello')
  })

  test('single empty line → empty', () => {
    expect(stripEmptyLines('')).toBe('')
  })

  test('lines with leading/trailing spaces preserved within content', () => {
    // Content lines (non-trim-empty) keep their internal whitespace.
    expect(stripEmptyLines('  hello  \n  world  ')).toBe(
      '  hello  \n  world  ',
    )
  })

  test('CRLF input — \\r remains in content (not trimmed by .trim()? probe)', () => {
    // .trim() removes whitespace including \r. So `\r` only line counts
    // as empty. But content lines with trailing \r retain it.
    // Documents this quirk: CRLF-source bash output may have stray \r.
    expect(stripEmptyLines('\r\nhello\r\n\r\n')).toBe('hello\r')
  })
})

describe('isImageOutput — data URI detection', () => {
  test('typical png data URI → true', () => {
    expect(
      isImageOutput('data:image/png;base64,iVBORw0K...'),
    ).toBe(true)
  })

  test('jpeg data URI → true', () => {
    expect(isImageOutput('data:image/jpeg;base64,/9j/4...')).toBe(true)
  })

  test('webp data URI → true', () => {
    expect(isImageOutput('data:image/webp;base64,UklGR...')).toBe(true)
  })

  test('case-insensitive for "data:image/" prefix', () => {
    expect(isImageOutput('DATA:IMAGE/PNG;base64,X')).toBe(true)
  })

  test('non-image data URI (text/html) → false', () => {
    expect(isImageOutput('data:text/html;base64,X')).toBe(false)
  })

  test('plain text → false', () => {
    expect(isImageOutput('hello world')).toBe(false)
  })

  test('empty string → false', () => {
    expect(isImageOutput('')).toBe(false)
  })

  test('image MIME with letters/digits/+/_/-/. in subtype', () => {
    // The regex allows [a-z0-9.+_-] in MIME subtype.
    expect(isImageOutput('data:image/svg+xml;base64,X')).toBe(true)
    expect(isImageOutput('data:image/x-icon;base64,X')).toBe(true)
  })

  test('NOT base64 → still true (regex is prefix-only)', () => {
    // The check is just "starts with data:image/{type};base64,". The
    // payload validity is checked elsewhere (parseDataUri).
    expect(isImageOutput('data:image/png;base64,not-base64!')).toBe(true)
  })

  test('missing base64 part → false', () => {
    expect(isImageOutput('data:image/png;X')).toBe(false)
  })

  test('substring match — leading prefix needed', () => {
    // Anchored to start. A data URI in the middle of text doesn't trigger.
    expect(isImageOutput('hello data:image/png;base64,X')).toBe(false)
  })
})
