import { describe, expect, test } from 'bun:test'
import { sanitizeBetaHeaders } from '../betas.js'

describe('sanitizeBetaHeaders', () => {
  test('strips whitespace and dedupes', () => {
    expect(sanitizeBetaHeaders(['  a ', 'a', 'b', '', '  ', 'c '])).toEqual([
      'a',
      'b',
      'c',
    ])
  })
  test('preserves order of first occurrence', () => {
    expect(sanitizeBetaHeaders(['c', 'a', 'b', 'a', 'c'])).toEqual([
      'c',
      'a',
      'b',
    ])
  })
  test('drops pure-whitespace entries', () => {
    expect(sanitizeBetaHeaders(['   ', '\t', 'real'])).toEqual(['real'])
  })
  test('empty input → empty output', () => {
    expect(sanitizeBetaHeaders([])).toEqual([])
  })
  test('idempotent — running twice gives the same result', () => {
    const input = ['  context-1m-2025-06-01 ', 'beta-x', 'context-1m-2025-06-01']
    const once = sanitizeBetaHeaders(input)
    const twice = sanitizeBetaHeaders(once)
    expect(once).toEqual(twice)
  })
  test('handles tab + newline whitespace', () => {
    expect(sanitizeBetaHeaders(['  a\t', '\n b\n', 'c\r'])).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})
