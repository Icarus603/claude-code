import { describe, expect, test } from 'bun:test'
import {
  formatDuration,
  formatFileSize,
  formatNumber,
  formatSecondsShort,
  formatTokens,
} from '../formatters/format.js'

describe('formatFileSize', () => {
  test('< 1 KB shows bytes', () => {
    expect(formatFileSize(0)).toBe('0 bytes')
    expect(formatFileSize(512)).toBe('512 bytes')
    expect(formatFileSize(1023)).toBe('1023 bytes')
  })
  test('1 KB is the boundary', () => {
    expect(formatFileSize(1024)).toBe('1KB')
  })
  test('strips trailing .0', () => {
    expect(formatFileSize(2048)).toBe('2KB')
    expect(formatFileSize(1024 * 1024)).toBe('1MB')
  })
  test('1.5 KB shows 1 decimal', () => {
    expect(formatFileSize(1536)).toBe('1.5KB')
  })
  test('crosses to MB at 1024 KB', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1MB')
    expect(formatFileSize(1024 * 1024 * 1.5)).toBe('1.5MB')
  })
  test('crosses to GB at 1024 MB', () => {
    expect(formatFileSize(1024 ** 3)).toBe('1GB')
    expect(formatFileSize(1024 ** 3 * 2.5)).toBe('2.5GB')
  })
})

describe('formatSecondsShort', () => {
  test('always uses 1 decimal', () => {
    expect(formatSecondsShort(0)).toBe('0.0s')
    expect(formatSecondsShort(1500)).toBe('1.5s')
  })
  test('handles sub-second values', () => {
    expect(formatSecondsShort(100)).toBe('0.1s')
    expect(formatSecondsShort(50)).toBe('0.1s') // rounds to 0.1
  })
  test('large values', () => {
    expect(formatSecondsShort(60000)).toBe('60.0s')
  })
})

describe('formatDuration (under 1 minute)', () => {
  test('zero', () => {
    expect(formatDuration(0)).toBe('0s')
  })
  test('sub-millisecond uses 1 decimal', () => {
    // ms < 1, branch shows N.0s decimals
    expect(formatDuration(0.5)).toBe('0.0s')
  })
  test('integer seconds use no decimal under 1 minute', () => {
    expect(formatDuration(1500)).toBe('1s')
    expect(formatDuration(45000)).toBe('45s')
  })
})

describe('formatDuration (≥ 1 minute)', () => {
  test('minute + seconds', () => {
    expect(formatDuration(90000)).toBe('1m 30s')
  })
  test('hide-trailing-zeros drops zero seconds', () => {
    expect(formatDuration(60000, { hideTrailingZeros: true })).toBe('1m')
  })
  test('hours threshold', () => {
    expect(formatDuration(3600000)).toBe('1h 0m 0s')
    expect(formatDuration(3600000, { hideTrailingZeros: true })).toBe('1h')
  })
  test('hide-trailing-zeros keeps minutes when seconds=0', () => {
    expect(
      formatDuration(3600000 + 60000, { hideTrailingZeros: true }),
    ).toBe('1h 1m')
  })
  test('days', () => {
    expect(formatDuration(86400000 * 2)).toBe('2d 0h 0m')
  })
  test('mostSignificantOnly: just biggest unit', () => {
    expect(formatDuration(60000, { mostSignificantOnly: true })).toBe('1m')
    expect(formatDuration(3600000, { mostSignificantOnly: true })).toBe('1h')
    expect(formatDuration(86400000, { mostSignificantOnly: true })).toBe('1d')
  })
  test('rounding carry-over: 59.5s in mid-minute rounds correctly', () => {
    // 119500ms = 1m 59.5s → should round to 2m 0s
    expect(formatDuration(119500)).toBe('2m 0s')
  })
})

describe('formatNumber', () => {
  test('small numbers unchanged', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(42)).toBe('42')
    expect(formatNumber(999)).toBe('999')
  })
  test('1000+ uses compact notation lowercased', () => {
    // 1.3K → "1.3k"
    expect(formatNumber(1321)).toBe('1.3k')
  })
  test('1000+ keeps trailing .0 (consistent decimals branch)', () => {
    expect(formatNumber(1000)).toBe('1.0k')
  })
  test('millions', () => {
    expect(formatNumber(1500000)).toMatch(/^1\.5m$/)
  })
})

describe('formatTokens', () => {
  test('small counts unchanged', () => {
    expect(formatTokens(42)).toBe('42')
  })
  test('strips .0 for compact-notation values', () => {
    // 1000 → "1.0k" → "1k"
    expect(formatTokens(1000)).toBe('1k')
  })
  test('keeps non-zero decimal', () => {
    // 1321 → "1.3k" — no .0 to strip
    expect(formatTokens(1321)).toBe('1.3k')
  })
})
