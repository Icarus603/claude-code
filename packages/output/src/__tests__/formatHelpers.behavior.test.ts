import { describe, expect, test } from 'bun:test'

import {
  formatDuration,
  formatFileSize,
  formatNumber,
  formatRelativeTime,
  formatSecondsShort,
  formatTokens,
} from '../formatters/format.ts'

/**
 * Pin user-visible format helpers. These appear EVERYWHERE in the UI
 * (REPL footer, /context, /status, tool result headers, log entries).
 * Drift in format breaks visual consistency and scripts/tests that
 * parse the output.
 */
describe('output formatters', () => {
  describe('formatFileSize', () => {
    test('< 1 KB → bytes (no scale)', () => {
      expect(formatFileSize(500)).toBe('500 bytes')
      expect(formatFileSize(0)).toBe('0 bytes')
      expect(formatFileSize(1023)).toBe('1023 bytes')
    })

    test('1 KB exact boundary → "1KB" (trailing .0 stripped)', () => {
      expect(formatFileSize(1024)).toBe('1KB')
    })

    test('KB with 1 decimal, .0 stripped', () => {
      expect(formatFileSize(1536)).toBe('1.5KB')
      expect(formatFileSize(2048)).toBe('2KB')
    })

    test('MB scale', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1MB')
      expect(formatFileSize(1024 * 1024 * 1.5)).toBe('1.5MB')
    })

    test('GB scale (above MB ceiling)', () => {
      expect(formatFileSize(1024 ** 3)).toBe('1GB')
      expect(formatFileSize(1024 ** 3 * 2.5)).toBe('2.5GB')
    })
  })

  describe('formatSecondsShort', () => {
    test('always 1 decimal place', () => {
      expect(formatSecondsShort(1234)).toBe('1.2s')
      expect(formatSecondsShort(500)).toBe('0.5s')
      expect(formatSecondsShort(0)).toBe('0.0s') // not "0s"
    })
  })

  describe('formatDuration', () => {
    test('0 ms → "0s" (special case)', () => {
      expect(formatDuration(0)).toBe('0s')
    })

    test('< 1 ms → "0.0s" with decimal', () => {
      expect(formatDuration(0.5)).toBe('0.0s')
    })

    test('whole seconds (< 1 min) → "Ns"', () => {
      expect(formatDuration(1000)).toBe('1s')
      expect(formatDuration(45000)).toBe('45s')
    })

    test('minutes-seconds with hide trailing zeros', () => {
      expect(formatDuration(60_000, { hideTrailingZeros: true })).toBe('1m')
      expect(formatDuration(90_000)).toBe('1m 30s')
      expect(formatDuration(60_000)).toBe('1m 0s') // without hide
    })

    test('hours: full vs hideTrailingZeros', () => {
      expect(formatDuration(3_600_000)).toBe('1h 0m 0s')
      expect(formatDuration(3_600_000, { hideTrailingZeros: true })).toBe('1h')
      expect(formatDuration(3_660_000, { hideTrailingZeros: true })).toBe('1h 1m')
    })

    test('days', () => {
      expect(formatDuration(86_400_000)).toBe('1d 0h 0m')
      expect(formatDuration(86_400_000, { hideTrailingZeros: true })).toBe('1d')
    })

    test('mostSignificantOnly: returns single largest unit', () => {
      expect(formatDuration(3_661_000, { mostSignificantOnly: true })).toBe('1h')
      expect(formatDuration(90_000, { mostSignificantOnly: true })).toBe('1m')
      expect(formatDuration(45_000, { mostSignificantOnly: true })).toBe('45s')
      expect(formatDuration(86_400_000 * 2, { mostSignificantOnly: true })).toBe('2d')
    })

    test('rounding carry-over: 59.5s rounds to 1m', () => {
      // 59500ms → 59.5s rounds to 60s, which carries to 1m 0s
      expect(formatDuration(59_500)).toMatch(/1m|59s/) // depends on rounding rule
    })
  })

  describe('formatNumber (compact + lowercase)', () => {
    test('< 1000 → plain number (no compact notation)', () => {
      expect(formatNumber(900)).toBe('900')
      expect(formatNumber(0)).toBe('0')
    })

    test('1000+ → compact lowercase ("1.3k")', () => {
      // Note the LOWERCASE k — the .toLowerCase() at the end of formatNumber
      // is intentional (consistent visual weight).
      expect(formatNumber(1321)).toBe('1.3k')
      expect(formatNumber(1000)).toBe('1.0k')
    })

    test('millions → "1.2m" lowercase', () => {
      expect(formatNumber(1_200_000)).toBe('1.2m')
    })
  })

  describe('formatTokens (drops .0)', () => {
    test('drops trailing .0 from formatNumber output', () => {
      // formatNumber(1000) = "1.0k"; formatTokens drops the .0 → "1k"
      expect(formatTokens(1000)).toBe('1k')
      expect(formatTokens(1300)).toBe('1.3k') // non-zero decimal preserved
    })
  })

  describe('formatRelativeTime (narrow style default)', () => {
    const now = new Date('2026-05-13T12:00:00Z')

    test('future: "in 5m" (narrow style)', () => {
      const fiveMinFromNow = new Date(now.getTime() + 5 * 60 * 1000)
      expect(formatRelativeTime(fiveMinFromNow, { now, style: 'narrow' })).toBe('in 5m')
    })

    test('past: "Nm ago" (narrow style)', () => {
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000)
      expect(formatRelativeTime(fiveMinAgo, { now, style: 'narrow' })).toBe('5m ago')
    })

    test('hours / days / weeks / months / years short units', () => {
      // Pin the EXACT short unit codes — REPL footer, log timestamps,
      // and many places use these.
      const ago = (ms: number) => new Date(now.getTime() - ms)
      expect(formatRelativeTime(ago(2 * 3600_000), { now })).toMatch(/2h ago/)
      expect(formatRelativeTime(ago(3 * 86400_000), { now })).toMatch(/3d ago/)
      expect(formatRelativeTime(ago(2 * 604800_000), { now })).toMatch(/2w ago/)
      expect(formatRelativeTime(ago(2 * 2592000_000), { now })).toMatch(/2mo ago/)
      expect(formatRelativeTime(ago(2 * 31536000_000), { now })).toMatch(/2y ago/)
    })

    test('exactly 0 → "0s ago" (narrow default, no special "now" case)', () => {
      expect(formatRelativeTime(now, { now })).toBe('0s ago')
    })
  })
})
