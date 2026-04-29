/**
 * Tests for formatRelativeTime — used in session list display, log
 * timestamps, and pretty-printed activity ages.
 *
 * The function takes an optional `now` for deterministic testing.
 * Wrong sign conventions = "5m ago" appears for future dates;
 * wrong unit-bucket cutoffs = "60m ago" instead of "1h ago".
 */
import { describe, expect, test } from 'bun:test'
import {
  formatRelativeTime,
  formatRelativeTimeAgo,
} from '../formatters/format.js'

const NOW = new Date('2026-04-30T12:00:00Z')

describe('formatRelativeTime — narrow style (default)', () => {
  test('1 second ago', () => {
    const date = new Date(NOW.getTime() - 1000)
    expect(formatRelativeTime(date, { now: NOW })).toBe('1s ago')
  })

  test('30 seconds in the future', () => {
    const date = new Date(NOW.getTime() + 30_000)
    expect(formatRelativeTime(date, { now: NOW })).toBe('in 30s')
  })

  test('5 minutes ago', () => {
    const date = new Date(NOW.getTime() - 5 * 60_000)
    expect(formatRelativeTime(date, { now: NOW })).toBe('5m ago')
  })

  test('60 seconds = 1m ago (bucket boundary)', () => {
    const date = new Date(NOW.getTime() - 60_000)
    expect(formatRelativeTime(date, { now: NOW })).toBe('1m ago')
  })

  test('59 seconds = stays in seconds bucket', () => {
    const date = new Date(NOW.getTime() - 59_000)
    expect(formatRelativeTime(date, { now: NOW })).toBe('59s ago')
  })

  test('2 hours ago', () => {
    const date = new Date(NOW.getTime() - 2 * 3600_000)
    expect(formatRelativeTime(date, { now: NOW })).toBe('2h ago')
  })

  test('3 days ago', () => {
    const date = new Date(NOW.getTime() - 3 * 86400_000)
    expect(formatRelativeTime(date, { now: NOW })).toBe('3d ago')
  })

  test('1 week ago', () => {
    const date = new Date(NOW.getTime() - 7 * 86400_000)
    expect(formatRelativeTime(date, { now: NOW })).toBe('1w ago')
  })

  test('1 month ago (~30 days)', () => {
    const date = new Date(NOW.getTime() - 30 * 86400_000)
    expect(formatRelativeTime(date, { now: NOW })).toBe('1mo ago')
  })

  test('1 year ago (~365 days)', () => {
    const date = new Date(NOW.getTime() - 365 * 86400_000)
    expect(formatRelativeTime(date, { now: NOW })).toBe('1y ago')
  })

  test('exactly now → "0s ago" (sub-second branch)', () => {
    expect(formatRelativeTime(NOW, { now: NOW })).toBe('0s ago')
  })

  test('500ms in the future → "0s ago" (sub-second truncates to 0)', () => {
    // Documented: diffInSeconds = trunc(500/1000) = 0, which falls
    // into the `<= 0 ? "0s ago"` branch. Sub-second futures are
    // bucketed with "now/past", not "in 0s". Locks the boundary.
    const date = new Date(NOW.getTime() + 500)
    expect(formatRelativeTime(date, { now: NOW })).toBe('0s ago')
  })

  test('1500ms in the future → "in 1s" (full second floor)', () => {
    const date = new Date(NOW.getTime() + 1500)
    expect(formatRelativeTime(date, { now: NOW })).toBe('in 1s')
  })
})

describe('formatRelativeTimeAgo', () => {
  test('past date: "X units ago" format', () => {
    const date = new Date(NOW.getTime() - 5 * 60_000)
    expect(formatRelativeTimeAgo(date, { now: NOW })).toBe('5m ago')
  })

  test('future date: same as formatRelativeTime', () => {
    // For future dates, formatRelativeTimeAgo just delegates without
    // forcing "ago" suffix.
    const date = new Date(NOW.getTime() + 5 * 60_000)
    expect(formatRelativeTimeAgo(date, { now: NOW })).toBe('in 5m')
  })

  test('exact present moment treated as past', () => {
    // date <= now → past path
    expect(formatRelativeTimeAgo(NOW, { now: NOW })).toBe('0s ago')
  })
})

describe('formatRelativeTime — sub-bucket truncation', () => {
  test('Math.trunc truncates toward zero (positive)', () => {
    // 1.9 hours = 6840 sec → trunc(6840/3600) = 1 (NOT round to 2)
    const date = new Date(NOW.getTime() - 1.9 * 3600_000)
    expect(formatRelativeTime(date, { now: NOW })).toBe('1h ago')
  })

  test('Math.trunc truncates toward zero (negative/future)', () => {
    const date = new Date(NOW.getTime() + 1.9 * 3600_000)
    expect(formatRelativeTime(date, { now: NOW })).toBe('in 1h')
  })

  test('boundary just below next unit stays in current bucket', () => {
    // 59 minutes 59 seconds = stays in minutes
    const date = new Date(NOW.getTime() - (59 * 60 + 59) * 1000)
    expect(formatRelativeTime(date, { now: NOW })).toBe('59m ago')
  })
})
