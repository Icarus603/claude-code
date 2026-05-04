/**
 * Unit-tests the modern-tag regex used by downloadVersionFromGithubReleases
 * to gate "missing .sha256 = refuse to install".
 *
 * Mirrors the pattern at download.ts:528. If you change the regex there,
 * update both. Pre-flight audit (2026-05-04): 107 releases, only v1.carus.000
 * lacks .sha256 — every modern (v26+) release has it.
 */
import { describe, expect, test } from 'bun:test'

const MODERN_TAG_RE = /^v(?:[1-9]\d+|\d{3,})\./

describe('sha256-enforcement modern-tag regex', () => {
  test.each([
    ['v26.5.17', true], // current series
    ['v26.4.80', true],
    ['v26.5.1', true],
    ['v25.1.1', true], // future-proof if year wraps
    ['v10.1.1', true], // boundary — 2-digit major
    ['v100.1.1', true], // 3-digit major
    ['v999.9.9', true],
  ])('modern tag %s → enforced', (tag, expected) => {
    expect(MODERN_TAG_RE.test(tag)).toBe(expected)
  })

  test.each([
    ['v1.carus.000', false], // sole historical release without .sha256
    ['v1.carus.009', false], // pre-V26 series — keep TLS fallback
    ['v2.1.888', false], // upstream ant tag — single-digit major
    ['v9.9.9', false], // single-digit major below 10
  ])('legacy/upstream tag %s → fallback allowed', (tag, expected) => {
    expect(MODERN_TAG_RE.test(tag)).toBe(expected)
  })

  test('non-tag strings → fallback (defensive)', () => {
    expect(MODERN_TAG_RE.test('')).toBe(false)
    expect(MODERN_TAG_RE.test('latest')).toBe(false)
    expect(MODERN_TAG_RE.test('main')).toBe(false)
  })
})
