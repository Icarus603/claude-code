/**
 * Tests for word slug generation. Used as plan filenames, session
 * identifiers, and similar memorable IDs.
 *
 * Wrong format (e.g., trailing dash) creates files with unexpected
 * names; wrong randomness produces duplicates that overwrite each
 * other.
 */
import { describe, expect, test } from 'bun:test'
import {
  generateShortWordSlug,
  generateWordSlug,
} from '../words.js'

describe('generateWordSlug — adjective-verb-noun shape', () => {
  test('returns a string', () => {
    expect(typeof generateWordSlug()).toBe('string')
  })

  test('exactly 3 hyphen-separated parts', () => {
    const parts = generateWordSlug().split('-')
    expect(parts).toHaveLength(3)
    for (const p of parts) {
      expect(p.length).toBeGreaterThan(0)
    }
  })

  test('lowercase only (no uppercase letters)', () => {
    for (let i = 0; i < 50; i++) {
      const slug = generateWordSlug()
      expect(slug).toBe(slug.toLowerCase())
    }
  })

  test('100 calls produce variety (not all identical)', () => {
    const slugs = new Set<string>()
    for (let i = 0; i < 100; i++) slugs.add(generateWordSlug())
    // With ADJECTIVES * VERBS * NOUNS combinations, 100 samples
    // should produce many distinct slugs.
    expect(slugs.size).toBeGreaterThan(50)
  })

  test('no leading or trailing hyphen', () => {
    const slug = generateWordSlug()
    expect(slug.startsWith('-')).toBe(false)
    expect(slug.endsWith('-')).toBe(false)
  })

  test('only alphanumeric + hyphen characters', () => {
    for (let i = 0; i < 30; i++) {
      const slug = generateWordSlug()
      expect(slug).toMatch(/^[a-z0-9-]+$/)
    }
  })
})

describe('generateShortWordSlug — adjective-noun shape', () => {
  test('exactly 2 hyphen-separated parts', () => {
    const parts = generateShortWordSlug().split('-')
    expect(parts).toHaveLength(2)
    for (const p of parts) {
      expect(p.length).toBeGreaterThan(0)
    }
  })

  test('lowercase only', () => {
    for (let i = 0; i < 30; i++) {
      const slug = generateShortWordSlug()
      expect(slug).toBe(slug.toLowerCase())
    }
  })

  test('shorter (in average) than full slug', () => {
    // Both adjective and noun pools are large enough that the average
    // short slug is fewer hyphens, but no strict character-count
    // guarantee. Lock the structural difference (2 parts vs 3).
    expect(generateShortWordSlug().split('-')).toHaveLength(2)
    expect(generateWordSlug().split('-')).toHaveLength(3)
  })
})
