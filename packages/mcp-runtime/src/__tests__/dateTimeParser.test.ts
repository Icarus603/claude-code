/**
 * Tests for looksLikeISO8601 — gating decision for whether to attempt
 * Haiku-based natural-language parsing on user date input.
 *
 * Wrong "looks like" detection: legitimate ISO inputs get re-parsed
 * (waste of an LLM call), or natural-language inputs get treated as
 * ISO (skipped Haiku → invalid date string passed downstream).
 */
import { describe, expect, test } from 'bun:test'
import { looksLikeISO8601 } from '../dateTimeParser.js'

describe('looksLikeISO8601 — accepted shapes', () => {
  test('YYYY-MM-DD plain date', () => {
    expect(looksLikeISO8601('2026-04-30')).toBe(true)
  })

  test('YYYY-MM-DDTHH:MM:SS datetime', () => {
    expect(looksLikeISO8601('2026-04-30T12:00:00')).toBe(true)
  })

  test('YYYY-MM-DDTHH:MM:SSZ (UTC marker)', () => {
    expect(looksLikeISO8601('2026-04-30T12:00:00Z')).toBe(true)
  })

  test('YYYY-MM-DDTHH:MM:SS+TZ', () => {
    expect(looksLikeISO8601('2026-04-30T12:00:00-07:00')).toBe(true)
  })

  test('full microsecond precision', () => {
    expect(looksLikeISO8601('2026-04-30T12:00:00.123456Z')).toBe(true)
  })

  test('leading whitespace tolerated (trim before regex)', () => {
    expect(looksLikeISO8601('  2026-04-30  ')).toBe(true)
  })
})

describe('looksLikeISO8601 — rejected shapes', () => {
  test('empty string', () => {
    expect(looksLikeISO8601('')).toBe(false)
  })

  test('whitespace-only', () => {
    expect(looksLikeISO8601('   ')).toBe(false)
  })

  test('natural language ("tomorrow")', () => {
    expect(looksLikeISO8601('tomorrow')).toBe(false)
  })

  test('natural language ("next Monday")', () => {
    expect(looksLikeISO8601('next Monday')).toBe(false)
  })

  test('partial date ("2026-04-")', () => {
    // Documented INVALID example — incomplete prefix.
    expect(looksLikeISO8601('2026-04-')).toBe(false)
  })

  test('lone year ("2026")', () => {
    expect(looksLikeISO8601('2026')).toBe(false)
  })

  test('US date format ("04/30/2026")', () => {
    expect(looksLikeISO8601('04/30/2026')).toBe(false)
  })

  test('locale string ("April 30, 2026")', () => {
    expect(looksLikeISO8601('April 30, 2026')).toBe(false)
  })

  test('lone number string ("13")', () => {
    expect(looksLikeISO8601('13')).toBe(false)
  })

  test('YYYY-M-D (single-digit month/day rejected)', () => {
    // Regex requires \d{2}-\d{2}, so 2-digit padding is required.
    expect(looksLikeISO8601('2026-4-30')).toBe(false)
    expect(looksLikeISO8601('2026-04-3')).toBe(false)
  })

  test('5-digit year rejected (regex caps at 4)', () => {
    expect(looksLikeISO8601('20260-04-30')).toBe(false)
  })
})

describe('looksLikeISO8601 — boundary cases', () => {
  test('YYYY-MM-DD followed by space + time (not ISO format)', () => {
    // ISO requires T separator, not space. Strict check.
    expect(looksLikeISO8601('2026-04-30 12:00:00')).toBe(false)
  })

  test('YYYY-MM-DD followed by T (just T, no time) is accepted', () => {
    // Documented: regex matches `^\d{4}-\d{2}-\d{2}(T|$)` — T marker
    // OR end of string. Lone "T" lets caller pass through to the
    // downstream validator, which can reject it. Lock the behavior.
    expect(looksLikeISO8601('2026-04-30T')).toBe(true)
  })

  test('valid date followed by extra chars (not T or $) → false', () => {
    expect(looksLikeISO8601('2026-04-30X')).toBe(false)
  })
})
