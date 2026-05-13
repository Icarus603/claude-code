import { expect, test } from 'bun:test'
import {
  sanitizeUnicodeDashes,
  sanitizeUnicodeDashesArgv,
} from '../unicodeDashes.js'

test('sanitizeUnicodeDashes normalises en-dash to hyphen', () => {
  expect(sanitizeUnicodeDashes('rm \u2013rf /')).toBe('rm -rf /')
})

test('sanitizeUnicodeDashes normalises em-dash to hyphen', () => {
  expect(sanitizeUnicodeDashes('rm \u2014rf /')).toBe('rm -rf /')
})

test('sanitizeUnicodeDashes normalises horizontal-bar to hyphen', () => {
  expect(sanitizeUnicodeDashes('rm \u2015rf /')).toBe('rm -rf /')
})

test('sanitizeUnicodeDashes leaves ASCII hyphen untouched', () => {
  expect(sanitizeUnicodeDashes('rm -rf /tmp/foo')).toBe('rm -rf /tmp/foo')
})

test('sanitizeUnicodeDashes handles mixed dashes in one command', () => {
  // git push --force === git push --force after normalising both dashes
  expect(sanitizeUnicodeDashes('git push \u2014\u2014force')).toBe(
    'git push --force',
  )
})

test('sanitizeUnicodeDashesArgv normalises every argv element', () => {
  expect(sanitizeUnicodeDashesArgv(['rm', '\u2013rf', '/'])).toEqual([
    'rm',
    '-rf',
    '/',
  ])
})

test('sanitizeUnicodeDashes preserves non-dash unicode chars', () => {
  // The classifier should still see the rest of the unicode text untouched.
  expect(sanitizeUnicodeDashes('echo "café \u2014 menu"')).toBe(
    'echo "café - menu"',
  )
})

test('sanitizeUnicodeDashes handles empty string', () => {
  expect(sanitizeUnicodeDashes('')).toBe('')
})

test('sanitizeUnicodeDashes does NOT touch hyphen-minus alternatives (e.g. U+2212 minus sign)', () => {
  // U+2212 (mathematical minus) is intentionally NOT in the dash set —
  // shells don't treat it as a flag prefix, and false-positive rewriting
  // here would corrupt math output in echo commands etc. ant Le() only
  // covers U+2013/U+2014/U+2015.
  expect(sanitizeUnicodeDashes('echo "5 \u2212 3"')).toBe('echo "5 \u2212 3"')
})

test('sanitizeUnicodeDashes returns same content (no-dash input)', () => {
  const input = 'just a normal sentence'
  expect(sanitizeUnicodeDashes(input)).toBe(input)
})

test('sanitizeUnicodeDashes is idempotent on already-sanitized input', () => {
  const once = sanitizeUnicodeDashes('rm \u2013rf /')
  expect(sanitizeUnicodeDashes(once)).toBe(once)
})

test('sanitizeUnicodeDashesArgv handles empty array', () => {
  expect(sanitizeUnicodeDashesArgv([])).toEqual([])
})

test('sanitizeUnicodeDashesArgv preserves array length and ordering', () => {
  expect(
    sanitizeUnicodeDashesArgv(['a', '\u2013b', 'c', '\u2014d', 'e']),
  ).toEqual(['a', '-b', 'c', '-d', 'e'])
})

test('sanitizeUnicodeDashesArgv returns a new array (does not mutate input)', () => {
  const input = ['rm', '\u2013rf']
  const output = sanitizeUnicodeDashesArgv(input)
  expect(output).not.toBe(input)
  expect(input).toEqual(['rm', '\u2013rf']) // unchanged
})

test('sanitizeUnicodeDashes handles all three dash chars in one string', () => {
  // ant Le() applies one regex with all three chars in a character class
  // — verify each one is independently normalised to ASCII hyphen.
  expect(sanitizeUnicodeDashes('a\u2013b\u2014c\u2015d')).toBe('a-b-c-d')
})
