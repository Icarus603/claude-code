import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  memoryAge,
  memoryAgeDays,
  memoryFreshnessNote,
  memoryFreshnessText,
} from '../memoryAge.js'

const DAY_MS = 86_400_000
const NOW = Date.UTC(2026, 3, 29, 12, 0, 0) // 2026-04-29 12:00 UTC

let originalNow: () => number
beforeEach(() => {
  originalNow = Date.now
  Date.now = () => NOW
})
afterEach(() => {
  Date.now = originalNow
})

describe('memoryAgeDays', () => {
  test('today (mtime = now) → 0', () => {
    expect(memoryAgeDays(NOW)).toBe(0)
  })
  test('within 24h → 0 (floor-rounded)', () => {
    expect(memoryAgeDays(NOW - DAY_MS / 2)).toBe(0)
  })
  test('exactly 1 day ago → 1', () => {
    expect(memoryAgeDays(NOW - DAY_MS)).toBe(1)
  })
  test('5 days ago', () => {
    expect(memoryAgeDays(NOW - 5 * DAY_MS)).toBe(5)
  })
  test('clamps future timestamps to 0', () => {
    expect(memoryAgeDays(NOW + 10 * DAY_MS)).toBe(0)
  })
})

describe('memoryAge (human-readable)', () => {
  test('today', () => {
    expect(memoryAge(NOW)).toBe('today')
  })
  test('yesterday', () => {
    expect(memoryAge(NOW - DAY_MS)).toBe('yesterday')
  })
  test('N days ago (≥2)', () => {
    expect(memoryAge(NOW - 7 * DAY_MS)).toBe('7 days ago')
  })
  test('clamped future → today', () => {
    expect(memoryAge(NOW + DAY_MS)).toBe('today')
  })
})

describe('memoryFreshnessText', () => {
  test('today returns empty string (no caveat needed)', () => {
    expect(memoryFreshnessText(NOW)).toBe('')
  })
  test('yesterday returns empty string', () => {
    expect(memoryFreshnessText(NOW - DAY_MS)).toBe('')
  })
  test('2+ days old returns caveat with day count', () => {
    const text = memoryFreshnessText(NOW - 5 * DAY_MS)
    expect(text).toContain('5 days old')
    expect(text).toContain('point-in-time')
    expect(text).toContain('Verify')
  })
})

describe('memoryFreshnessNote', () => {
  test('wraps non-empty caveat in <system-reminder>', () => {
    const note = memoryFreshnessNote(NOW - 3 * DAY_MS)
    expect(note.startsWith('<system-reminder>')).toBe(true)
    expect(note.endsWith('</system-reminder>\n')).toBe(true)
  })
  test('returns empty string for fresh memory (no <system-reminder> wrapping)', () => {
    expect(memoryFreshnessNote(NOW)).toBe('')
    expect(memoryFreshnessNote(NOW - DAY_MS)).toBe('')
  })
})
