import { describe, expect, test } from 'bun:test'
import { extractDescriptionFromMarkdown } from '../utils/markdownDescription.js'

describe('extractDescriptionFromMarkdown', () => {
  test('uses the first non-empty line', () => {
    expect(extractDescriptionFromMarkdown('Hello world\n\nMore content')).toBe(
      'Hello world',
    )
  })
  test('strips header prefix from h1', () => {
    expect(extractDescriptionFromMarkdown('# My Skill\n\nbody')).toBe('My Skill')
  })
  test('strips header prefix from h2/h3/etc.', () => {
    expect(extractDescriptionFromMarkdown('### Heading 3\n\nbody')).toBe(
      'Heading 3',
    )
  })
  test('skips leading whitespace lines', () => {
    expect(extractDescriptionFromMarkdown('\n\n  \n\nfirst real')).toBe(
      'first real',
    )
  })
  test('returns default for empty content', () => {
    expect(extractDescriptionFromMarkdown('')).toBe('Custom item')
  })
  test('returns default when only whitespace', () => {
    expect(extractDescriptionFromMarkdown('\n  \n\t\n')).toBe('Custom item')
  })
  test('respects custom default', () => {
    expect(extractDescriptionFromMarkdown('', 'fallback name')).toBe(
      'fallback name',
    )
  })
  test('truncates long descriptions to ~100 chars with ellipsis', () => {
    const long = 'x'.repeat(150)
    const out = extractDescriptionFromMarkdown(long)
    expect(out.length).toBeLessThanOrEqual(100)
    expect(out.endsWith('...')).toBe(true)
  })
  test('does not truncate when length is exactly 100', () => {
    const exactly100 = 'x'.repeat(100)
    expect(extractDescriptionFromMarkdown(exactly100)).toBe(exactly100)
  })
  test('trims whitespace from the chosen line', () => {
    expect(extractDescriptionFromMarkdown('   indented header   \n\nbody')).toBe(
      'indented header',
    )
  })
})
