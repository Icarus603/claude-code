import { describe, expect, test } from 'bun:test'
import { buildRedirectUri } from '../oauthPort.js'

describe('buildRedirectUri', () => {
  // Critical contract: RFC 8252 §7.3 — loopback redirect URIs must use
  // http://localhost (NOT https or 127.0.0.1) and a fixed path. The IdP's
  // exact-match check on (scheme, host, path) is loose on port. If a
  // refactor "improves" by switching to 127.0.0.1 or https, OAuth fails
  // with cryptic redirect-uri-mismatch errors.

  test('default port (3118 fallback) when called with no args', () => {
    expect(buildRedirectUri()).toBe('http://localhost:3118/callback')
  })

  test('explicit port is interpolated correctly', () => {
    expect(buildRedirectUri(50001)).toBe('http://localhost:50001/callback')
  })

  test('uses http (NOT https) — loopback redirect spec', () => {
    expect(buildRedirectUri(8080)).toMatch(/^http:\/\//)
    expect(buildRedirectUri(8080)).not.toMatch(/^https:\/\//)
  })

  test('uses "localhost" host (NOT 127.0.0.1)', () => {
    // Critical: OAuth providers register the literal "localhost" string,
    // not the loopback IP. A refactor to 127.0.0.1 would silently fail
    // the IdP's exact-host-match check.
    expect(buildRedirectUri(8080)).toContain('localhost')
    expect(buildRedirectUri(8080)).not.toContain('127.0.0.1')
  })

  test('path is exactly "/callback" (lowercase, no trailing slash)', () => {
    // Path equality is part of the redirect-uri exact match. /Callback
    // (capital C) or /callback/ (trailing /) would fail the IdP check.
    expect(buildRedirectUri(8080)).toMatch(/\/callback$/)
    expect(buildRedirectUri(8080)).not.toContain('/Callback')
    expect(buildRedirectUri(8080)).not.toContain('/callback/')
  })

  test('port=0 produces "http://localhost:0/callback" (no special handling)', () => {
    // Documents that the function does NOT validate port range; passes
    // through whatever value the caller supplies. The caller's port
    // selection logic (findAvailablePort) is responsible for valid range.
    expect(buildRedirectUri(0)).toBe('http://localhost:0/callback')
  })

  test('port=65535 (max valid TCP port)', () => {
    expect(buildRedirectUri(65535)).toBe('http://localhost:65535/callback')
  })

  test('negative port pass-through (no validation — caller responsibility)', () => {
    // Function does not validate; documents this. If a buggy caller
    // computes -1, the URI is technically invalid but doesn't throw.
    expect(buildRedirectUri(-1)).toBe('http://localhost:-1/callback')
  })

  test('result is a valid URL parseable by URL constructor when port > 0', () => {
    const uri = buildRedirectUri(50001)
    expect(() => new URL(uri)).not.toThrow()
    const url = new URL(uri)
    expect(url.protocol).toBe('http:')
    expect(url.hostname).toBe('localhost')
    expect(url.port).toBe('50001')
    expect(url.pathname).toBe('/callback')
  })
})
