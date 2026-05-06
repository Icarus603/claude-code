import { describe, expect, test } from 'bun:test'
import { deriveForkSlug } from '../commands/fork/fork.js'

describe('deriveForkSlug', () => {
  test('derives kebab-case slug from first 3 words', () => {
    expect(deriveForkSlug('refactor the auth module')).toBe('refactor-the-auth')
  })

  test('lowercases everything', () => {
    expect(deriveForkSlug('Refactor The Auth Module')).toBe('refactor-the-auth')
  })

  test('strips non-alphanumeric chars', () => {
    expect(deriveForkSlug('fix bug #123!')).toBe('fix-bug-123')
  })

  test('collapses multiple dashes', () => {
    // "do -- it" → "do---it" (split by \s+ gives ['do', '--', 'it'],
    // join '-' = 'do---it', strip non-alpha keeps '-', then collapse
    // multi-dash to single. We expect 'do-it'.
    expect(deriveForkSlug('do -- it')).toBe('do-it')
  })

  test('strips leading and trailing dashes', () => {
    expect(deriveForkSlug('--leading')).toBe('leading')
    expect(deriveForkSlug('trailing--')).toBe('trailing')
  })

  test('truncates to 24 chars', () => {
    const directive = 'wordlongerthantwentyfour-extra-content'
    const slug = deriveForkSlug(directive)
    expect(slug.length).toBeLessThanOrEqual(24)
  })

  test('falls back to "fork" for empty/whitespace directive', () => {
    expect(deriveForkSlug('')).toBe('fork')
    expect(deriveForkSlug('   ')).toBe('fork')
  })

  test('falls back to "fork" when first 3 words have no alpha chars', () => {
    expect(deriveForkSlug('!!! ??? ###')).toBe('fork')
  })

  test('handles single-word directive', () => {
    expect(deriveForkSlug('hello')).toBe('hello')
  })

  test('only takes first 3 words', () => {
    expect(deriveForkSlug('one two three four five six')).toBe('one-two-three')
  })

  test('handles tabs and multiple spaces as word separators', () => {
    expect(deriveForkSlug('one\ttwo  three')).toBe('one-two-three')
  })

  test('preserves alphanumeric-only chars after split', () => {
    expect(deriveForkSlug('test123 end456 final789')).toBe(
      'test123-end456-final789',
    )
  })

  test('handles unicode by stripping it (kebab-case ASCII only)', () => {
    // The unicode word becomes empty after non-alpha strip; resulting
    // leading dash is then trimmed by the ^-|-$ rule.
    expect(deriveForkSlug('修一個 bug here')).toBe('bug-here')
  })

  test('determinism: same input produces same output', () => {
    const directive = 'refactor the auth module'
    expect(deriveForkSlug(directive)).toBe(deriveForkSlug(directive))
  })
})
