/**
 * Tests for computeContentHash + buildSurfaceKey — pure helpers
 * used by commit attribution. Wrong hash = file changes attributed
 * to wrong session; surface key collisions break per-surface
 * percentage breakdowns.
 */
import { describe, expect, test } from 'bun:test'
import { buildSurfaceKey, computeContentHash } from '../commitAttribution.js'

describe('computeContentHash', () => {
  test('returns SHA-256 hex string (64 chars)', () => {
    const r = computeContentHash('hello')
    expect(r).toMatch(/^[0-9a-f]{64}$/)
  })

  test('deterministic: same input → same hash', () => {
    expect(computeContentHash('hello')).toBe(computeContentHash('hello'))
  })

  test('different inputs → different hashes', () => {
    expect(computeContentHash('a')).not.toBe(computeContentHash('b'))
  })

  test('empty string has known SHA-256', () => {
    // Well-known SHA-256("") value.
    expect(computeContentHash('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  test('handles unicode (UTF-8 byte hash, not codepoints)', () => {
    const a = computeContentHash('hello')
    const b = computeContentHash('héllo')
    expect(a).not.toBe(b)
  })

  test('hashes are case-stable (lowercase hex)', () => {
    const r = computeContentHash('test')
    expect(r).toBe(r.toLowerCase())
  })

  test('100KB content: still produces 64-char hash', () => {
    const big = 'x'.repeat(100_000)
    expect(computeContentHash(big)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('buildSurfaceKey', () => {
  test('joins surface + canonical model with "/"', () => {
    // The canonical-name lookup may map to itself if model is unknown
    // — we lock the structure.
    const r = buildSurfaceKey('cli', 'claude-opus-4-7' as never)
    expect(r).toMatch(/^cli\//)
    expect(r.length).toBeGreaterThan(4)
  })

  test('surface preserved verbatim', () => {
    expect(buildSurfaceKey('vscode', 'claude-opus-4-7' as never)).toMatch(
      /^vscode\//,
    )
    expect(buildSurfaceKey('sdk', 'claude-opus-4-7' as never)).toMatch(/^sdk\//)
  })

  test('different surfaces produce different keys (even with same model)', () => {
    const a = buildSurfaceKey('cli', 'claude-opus-4-7' as never)
    const b = buildSurfaceKey('vscode', 'claude-opus-4-7' as never)
    expect(a).not.toBe(b)
  })
})
