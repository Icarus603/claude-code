import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '../lessons/index.js'

describe('powerup lessons', () => {
  test('exactly 10 lessons (matches spec §3 and banner denominator)', () => {
    expect(ALL_LESSONS).toHaveLength(10)
  })

  test('all ids are unique', () => {
    const ids = ALL_LESSONS.map(l => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('all ids are kebab-case', () => {
    for (const l of ALL_LESSONS) {
      expect(l.id).toMatch(/^[a-z][a-z-]+[a-z]$/)
    }
  })

  test('every lesson has non-empty title and tagline', () => {
    for (const l of ALL_LESSONS) {
      expect(l.title.length).toBeGreaterThan(0)
      expect(l.tagline.length).toBeGreaterThan(0)
    }
  })

  test('every tagline stays under the 30-char budget', () => {
    for (const l of ALL_LESSONS) {
      expect(l.tagline.length).toBeLessThanOrEqual(30)
    }
  })

  test('every lesson has a body', () => {
    for (const l of ALL_LESSONS) {
      expect(l.body).toBeTruthy()
    }
  })

  test('expected ids present (locks the spec set)', () => {
    expect(new Set(ALL_LESSONS.map(l => l.id))).toEqual(
      new Set([
        'at-mentions',
        'modes',
        'undo',
        'background',
        'memory',
        'mcp',
        'automate',
        'fork',
        'model-dial',
        'multi-provider',
      ]),
    )
  })
})
