/**
 * Tests for OAuth pure helpers.
 *
 * isOAuthTokenExpired decides whether to refresh — wrong logic either
 * shows the user spurious "auth expired" prompts (false-positive) or
 * silently passes a stale token to the API (false-negative → 401).
 *
 * shouldUseClaudeAIAuth gates the Console-vs-Claude.ai code path —
 * misclassification routes auth headers to the wrong endpoint.
 *
 * parseScopes round-trips the OAuth-spec scope list — wrong split
 * makes scope checks fail downstream.
 */
import { describe, expect, test } from 'bun:test'
import {
  isOAuthTokenExpired,
  parseScopes,
  shouldUseClaudeAIAuth,
} from '../oauth/client.js'

describe('isOAuthTokenExpired', () => {
  test('null expiresAt → never expired (long-lived token)', () => {
    expect(isOAuthTokenExpired(null)).toBe(false)
  })

  test('expiresAt in the far future → not expired', () => {
    const farFuture = Date.now() + 24 * 60 * 60 * 1000 // 1 day
    expect(isOAuthTokenExpired(farFuture)).toBe(false)
  })

  test('expiresAt in the past → expired', () => {
    const past = Date.now() - 1000
    expect(isOAuthTokenExpired(past)).toBe(true)
  })

  test('expiresAt at exact now → expired (5min buffer)', () => {
    expect(isOAuthTokenExpired(Date.now())).toBe(true)
  })

  test('5-minute buffer: token expiring in 4 minutes is treated as expired', () => {
    // The function refreshes 5min EARLY to avoid mid-request expiry.
    const fourMinFromNow = Date.now() + 4 * 60 * 1000
    expect(isOAuthTokenExpired(fourMinFromNow)).toBe(true)
  })

  test('5-minute buffer: token expiring in 6 minutes is NOT expired yet', () => {
    const sixMinFromNow = Date.now() + 6 * 60 * 1000
    expect(isOAuthTokenExpired(sixMinFromNow)).toBe(false)
  })

  test('exactly at 5-min boundary: expired (>= comparison)', () => {
    // The check is `expiresWithBuffer >= expiresAt` (≥, not >).
    // expiresWithBuffer = now + 5min. So token at exactly now+5min
    // satisfies the check → expired.
    const fiveMinFromNow = Date.now() + 5 * 60 * 1000
    expect(isOAuthTokenExpired(fiveMinFromNow)).toBe(true)
  })
})

describe('shouldUseClaudeAIAuth', () => {
  test('undefined scopes → false', () => {
    expect(shouldUseClaudeAIAuth(undefined)).toBe(false)
  })

  test('empty scopes → false', () => {
    expect(shouldUseClaudeAIAuth([])).toBe(false)
  })

  test('scopes without "user:inference" → false', () => {
    expect(shouldUseClaudeAIAuth(['user:profile', 'org:read'])).toBe(false)
  })

  test('scopes containing "user:inference" → true', () => {
    expect(shouldUseClaudeAIAuth(['user:inference', 'user:profile'])).toBe(true)
  })

  test('only "user:inference" → true', () => {
    expect(shouldUseClaudeAIAuth(['user:inference'])).toBe(true)
  })

  test('case-sensitive: "USER:INFERENCE" → false', () => {
    expect(shouldUseClaudeAIAuth(['USER:INFERENCE'])).toBe(false)
  })
})

describe('parseScopes', () => {
  test('undefined → empty array', () => {
    expect(parseScopes(undefined)).toEqual([])
  })

  test('empty string → empty array', () => {
    expect(parseScopes('')).toEqual([])
  })

  test('single scope', () => {
    expect(parseScopes('user:inference')).toEqual(['user:inference'])
  })

  test('space-separated multi-scope', () => {
    expect(parseScopes('user:inference user:profile org:read')).toEqual([
      'user:inference',
      'user:profile',
      'org:read',
    ])
  })

  test('multiple consecutive spaces filtered out', () => {
    // ".filter(Boolean)" drops empty-string segments from double spaces.
    expect(parseScopes('a   b')).toEqual(['a', 'b'])
  })

  test('leading/trailing spaces produce empty segments → filtered', () => {
    expect(parseScopes(' a b ')).toEqual(['a', 'b'])
  })

  test('whitespace-only string → empty array', () => {
    expect(parseScopes('   ')).toEqual([])
  })
})
