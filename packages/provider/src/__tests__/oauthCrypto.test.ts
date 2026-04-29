import { describe, expect, test } from 'bun:test'
import { createHash } from 'crypto'
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from '../oauth/crypto.js'

// Why these tests matter: PKCE (RFC 7636) requires code_verifier and
// code_challenge to be base64url-encoded *without padding*, and state
// must be high-entropy. Any subtle change here (e.g., a refactor that
// introduces base64 padding, or replaces sha256 with sha1) breaks the
// OAuth flow with cryptic 400-class errors from the IdP. These tests
// lock down the wire-format contract.

const BASE64_URL_RE = /^[A-Za-z0-9_-]+$/
const BASE64_PADDED_RE = /=$/

describe('generateCodeVerifier', () => {
  test('returns a base64url-encoded string (no padding)', () => {
    const v = generateCodeVerifier()
    expect(v).toMatch(BASE64_URL_RE)
    expect(v).not.toMatch(BASE64_PADDED_RE)
  })

  test('does NOT contain "+", "/", or "=" (vanilla base64 chars)', () => {
    // Critical: PKCE spec mandates URL-safe alphabet. If a refactor
    // accidentally drops the .replace() calls, the verifier would
    // reach the IdP URL-encoded, which doubles the length and
    // exceeds the 128-char max in some implementations.
    const v = generateCodeVerifier()
    expect(v).not.toContain('+')
    expect(v).not.toContain('/')
    expect(v).not.toContain('=')
  })

  test('is at least 43 characters (RFC 7636 §4.1 min)', () => {
    // randomBytes(32) → base64 → 43 chars (4*ceil(32/3) - padding).
    const v = generateCodeVerifier()
    expect(v.length).toBeGreaterThanOrEqual(43)
  })

  test('is at most 128 characters (RFC 7636 §4.1 max)', () => {
    const v = generateCodeVerifier()
    expect(v.length).toBeLessThanOrEqual(128)
  })

  test('two consecutive calls return different values (entropy check)', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier())
  })

  test('100 distinct calls produce 100 distinct verifiers', () => {
    const set = new Set<string>()
    for (let i = 0; i < 100; i++) set.add(generateCodeVerifier())
    expect(set.size).toBe(100)
  })
})

describe('generateCodeChallenge', () => {
  test('is the base64url SHA-256 of the verifier', () => {
    const verifier = 'test-verifier-123'
    const expected = createHash('sha256')
      .update(verifier)
      .digest()
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
    expect(generateCodeChallenge(verifier)).toBe(expected)
  })

  test('is deterministic (same input → same output)', () => {
    const verifier = 'repeat-me'
    expect(generateCodeChallenge(verifier)).toBe(generateCodeChallenge(verifier))
  })

  test('differs for different verifiers', () => {
    expect(generateCodeChallenge('a')).not.toBe(generateCodeChallenge('b'))
  })

  test('returns base64url (no padding, URL-safe alphabet)', () => {
    const c = generateCodeChallenge('any-input')
    expect(c).toMatch(BASE64_URL_RE)
    expect(c).not.toMatch(BASE64_PADDED_RE)
  })

  test('SHA-256 produces a 43-char base64url-no-padding result', () => {
    // SHA-256 = 32 bytes → 43 chars in base64-no-padding.
    expect(generateCodeChallenge('x').length).toBe(43)
  })

  test('handles empty verifier', () => {
    // Spec doesn't really allow empty verifier, but the function
    // shouldn't throw — sha256("") is a valid 32-byte digest.
    const c = generateCodeChallenge('')
    expect(c.length).toBe(43)
  })

  test('handles unicode verifier (full UTF-8 input)', () => {
    const c = generateCodeChallenge('hello-世界-🌍')
    expect(c).toMatch(BASE64_URL_RE)
    expect(c.length).toBe(43)
  })
})

describe('generateState', () => {
  test('returns base64url (no padding, URL-safe alphabet)', () => {
    const s = generateState()
    expect(s).toMatch(BASE64_URL_RE)
    expect(s).not.toMatch(BASE64_PADDED_RE)
  })

  test('is high-entropy (43+ chars)', () => {
    expect(generateState().length).toBeGreaterThanOrEqual(43)
  })

  test('two consecutive calls return different values', () => {
    expect(generateState()).not.toBe(generateState())
  })

  test('100 distinct calls produce 100 distinct states', () => {
    const set = new Set<string>()
    for (let i = 0; i < 100; i++) set.add(generateState())
    expect(set.size).toBe(100)
  })
})

describe('PKCE round-trip', () => {
  // End-to-end: generate verifier, compute challenge, verify the
  // server-side check that's the contract. This is what the IdP
  // does after the auth code exchange.
  test('verifier + challenge satisfy PKCE S256 method', () => {
    const verifier = generateCodeVerifier()
    const challenge = generateCodeChallenge(verifier)
    const recomputed = createHash('sha256')
      .update(verifier)
      .digest()
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
    expect(challenge).toBe(recomputed)
  })
})
