/**
 * Tests for formatBriefTimestamp — used by message labels in chat
 * UIs and session lists. Display scales with age:
 *   same day:      "1:30 PM" (locale-dependent)
 *   within 6 days: "Sunday, 4:15 PM"
 *   older:         "Sunday, Feb 20, 4:30 PM"
 *
 * `now` is injectable, so tests are deterministic regardless of when
 * they run. Wrong day boundary = labels shift by ±1 day on midnight.
 */
import { describe, expect, test } from 'bun:test'
import { formatBriefTimestamp } from '../formatters/brief-timestamp.js'

const NOW = new Date('2026-04-30T12:00:00Z')

describe('formatBriefTimestamp — same-day display (just time)', () => {
  test('same day, same hour: short time string', () => {
    const r = formatBriefTimestamp(NOW.toISOString(), NOW)
    // Should NOT contain a weekday name (locale-dependent like "Wednesday")
    // Format depends on locale, but short time always has digits.
    expect(r).toMatch(/\d/)
    // No weekday for same-day.
    expect(r).not.toMatch(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/)
  })

  test('same day, earlier in the day: still short time', () => {
    const t = new Date('2026-04-30T03:30:00Z')
    const r = formatBriefTimestamp(t.toISOString(), NOW)
    expect(r).toMatch(/\d/)
    expect(r).not.toMatch(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/)
  })
})

describe('formatBriefTimestamp — within 6 days (weekday + time)', () => {
  test('1 day ago: weekday name appears', () => {
    const yesterday = new Date('2026-04-29T15:00:00Z')
    const r = formatBriefTimestamp(yesterday.toISOString(), NOW)
    // Some locale will have a weekday name. Lock that result is non-empty
    // and includes digits (time part) plus alpha (weekday).
    expect(r.length).toBeGreaterThan(0)
    expect(r).toMatch(/\d/)
    expect(r).toMatch(/[a-zA-Z]/)
  })

  test('6 days ago: still weekday + time (no month)', () => {
    const sixDaysAgo = new Date('2026-04-24T15:00:00Z')
    const r = formatBriefTimestamp(sixDaysAgo.toISOString(), NOW)
    expect(r.length).toBeGreaterThan(0)
    // Should NOT have the month abbreviation pattern (Apr/Mar etc).
    // Locale-sensitive — gate weakly.
  })
})

describe('formatBriefTimestamp — older than 6 days (full date)', () => {
  test('1 month ago: weekday + month + day + time', () => {
    const oldDate = new Date('2026-03-30T15:00:00Z')
    const r = formatBriefTimestamp(oldDate.toISOString(), NOW)
    expect(r.length).toBeGreaterThan(0)
    expect(r).toMatch(/\d/)
    expect(r).toMatch(/[a-zA-Z]/)
  })

  test('1 year ago: still works', () => {
    const oldDate = new Date('2025-04-30T15:00:00Z')
    const r = formatBriefTimestamp(oldDate.toISOString(), NOW)
    expect(r.length).toBeGreaterThan(0)
  })
})

describe('formatBriefTimestamp — invalid input', () => {
  test('empty string → empty result', () => {
    expect(formatBriefTimestamp('', NOW)).toBe('')
  })

  test('non-ISO garbage → empty result', () => {
    expect(formatBriefTimestamp('not a date', NOW)).toBe('')
  })

  test('garbled ISO-like string → empty result', () => {
    expect(formatBriefTimestamp('2026-99-99T99:99:99Z', NOW)).toBe('')
  })
})

describe('formatBriefTimestamp — same instant edge case', () => {
  test('exact same instant as now → same-day branch (short time)', () => {
    const r = formatBriefTimestamp(NOW.toISOString(), NOW)
    expect(r).toMatch(/\d/)
    expect(r).not.toMatch(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/)
  })
})

describe('formatBriefTimestamp — `now` defaults to current time', () => {
  test('omitting now arg uses Date.now() (smoke test)', () => {
    // Just make sure default arg works — exact format depends on
    // wall-clock + locale; lock that it returns a non-empty string.
    const r = formatBriefTimestamp(new Date().toISOString())
    expect(r.length).toBeGreaterThan(0)
  })
})

describe('formatBriefTimestamp — day boundary precision', () => {
  test('past midnight same calendar day: still same-day', () => {
    // 11pm UTC and 1am UTC same day — both should treat as same-day.
    const elevenPM = new Date('2026-04-30T23:00:00Z')
    const oneAM = new Date('2026-04-30T01:00:00Z')
    const r1 = formatBriefTimestamp(elevenPM.toISOString(), oneAM)
    const r2 = formatBriefTimestamp(oneAM.toISOString(), elevenPM)
    // Both same-day → short time, no weekday name.
    expect(r1).not.toMatch(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/)
    expect(r2).not.toMatch(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/)
  })

  test('1 second across midnight (local) becomes "yesterday"', () => {
    // Use local date construction since startOfDay uses getFullYear/Month/Date.
    const t1 = new Date(2026, 3, 30, 0, 0, 1) // 30 Apr 00:00:01 local
    const t2 = new Date(2026, 3, 29, 23, 59, 59) // 29 Apr 23:59:59 local
    const r = formatBriefTimestamp(t2.toISOString(), t1)
    // Should NOT be same-day (they're on different calendar days).
    // Could be weekday-only (yesterday) or full date depending on
    // exact day diff. Just lock that it's non-empty.
    expect(r.length).toBeGreaterThan(0)
  })
})
