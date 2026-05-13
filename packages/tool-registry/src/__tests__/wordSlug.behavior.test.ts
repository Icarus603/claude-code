import { describe, expect, test } from 'bun:test'

import {
  generateShortWordSlug,
  generateWordSlug,
} from '../words.ts'

/**
 * Pin word slug generation. Used for:
 *  - Spinner messages ("gleaming-brewing-phoenix is thinking...")
 *  - Dev server names
 *  - Background worker identifiers
 *
 * The format is part of the user-visible UI; a regression that produces
 * malformed slugs (single word, with spaces, etc.) would look broken.
 */
describe('word slug generators', () => {
  test('generateWordSlug: "<adjective>-<verb>-<noun>" format', () => {
    for (let i = 0; i < 20; i++) {
      const slug = generateWordSlug()
      const parts = slug.split('-')
      expect(parts.length).toBe(3)
      // Each part is a non-empty word
      for (const part of parts) {
        expect(part.length).toBeGreaterThan(0)
        // Letters only (no numbers, no symbols)
        expect(part).toMatch(/^[a-z]+$/)
      }
    }
  })

  test('generateShortWordSlug: "<adjective>-<noun>" format (no verb)', () => {
    for (let i = 0; i < 20; i++) {
      const slug = generateShortWordSlug()
      const parts = slug.split('-')
      expect(parts.length).toBe(2)
      for (const part of parts) {
        expect(part.length).toBeGreaterThan(0)
        expect(part).toMatch(/^[a-z]+$/)
      }
    }
  })

  test('generated slugs are mostly unique across many calls (entropy check)', () => {
    // With 200+ adj × 400+ noun × 100+ verb, 200 samples should have very few collisions
    const set = new Set<string>()
    for (let i = 0; i < 200; i++) {
      set.add(generateWordSlug())
    }
    // Conservative: expect at least 195 unique out of 200 (allows tiny collision rate)
    expect(set.size).toBeGreaterThanOrEqual(195)
  })

  test('no slug contains whitespace, underscores, or quotes (URL/identifier-safe)', () => {
    for (let i = 0; i < 20; i++) {
      const slug = generateWordSlug()
      expect(slug).not.toMatch(/\s/)
      expect(slug).not.toContain('_')
      expect(slug).not.toContain("'")
      expect(slug).not.toContain('"')
    }
  })

  test('always lowercase (no uppercase letters)', () => {
    for (let i = 0; i < 20; i++) {
      const slug = generateWordSlug()
      expect(slug).toBe(slug.toLowerCase())
    }
  })
})
