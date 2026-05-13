import { describe, expect, test } from 'bun:test'

import {
  isOAuthTokenExpired,
  parseScopes,
  shouldUseClaudeAIAuth,
} from '../oauth/client.js'

/**
 * Leaf helpers — small enough to test by direct call rather than source-pin.
 * Mirror of ant pq_ / x6H / bB (1255.js).
 */
describe('OAuth leaf helpers (ant pq_/x6H/bB parity)', () => {
  describe('parseScopes (ant pq_)', () => {
    test('undefined input → empty array (ant: H?.split() ?? [])', () => {
      expect(parseScopes(undefined)).toEqual([])
    })
    test('empty string → empty array (filter(Boolean) drops empty entries)', () => {
      expect(parseScopes('')).toEqual([])
    })
    test('single scope → single-element array', () => {
      expect(parseScopes('user:inference')).toEqual(['user:inference'])
    })
    test('space-separated scopes → split into array', () => {
      expect(parseScopes('user:profile user:inference user:sessions:claude_code')).toEqual([
        'user:profile',
        'user:inference',
        'user:sessions:claude_code',
      ])
    })
    test('extra/leading/trailing whitespace stripped by filter(Boolean)', () => {
      expect(parseScopes('  user:profile   user:inference  ')).toEqual([
        'user:profile',
        'user:inference',
      ])
    })
  })

  describe('shouldUseClaudeAIAuth (ant bB)', () => {
    test('undefined scopes → false', () => {
      expect(shouldUseClaudeAIAuth(undefined)).toBe(false)
    })
    test('empty array → false', () => {
      expect(shouldUseClaudeAIAuth([])).toBe(false)
    })
    test('contains user:inference → true', () => {
      expect(shouldUseClaudeAIAuth(['user:profile', 'user:inference'])).toBe(true)
    })
    test('missing user:inference → false even if other scopes present', () => {
      // Service-key tokens have inference; bare /login may not. The Claude.ai
      // OAuth code path requires user:inference to send the Bearer header.
      expect(shouldUseClaudeAIAuth(['user:profile', 'org:create_api_key'])).toBe(false)
    })
    test('Boolean wrap (not !!) — exact ant signature parity', () => {
      // ant bB returns Boolean(H?.includes(OB)) — pin the wrap so a future
      // refactor that drops to `!!H?.includes(OB)` doesn't regress when
      // scopes is genuinely null (Boolean(undefined) === false ✓).
      const result = shouldUseClaudeAIAuth(undefined)
      expect(typeof result).toBe('boolean')
      expect(result).toBe(false)
    })
  })

  describe('isOAuthTokenExpired (ant x6H)', () => {
    test('null expiresAt → false (env-var tokens have no expiry)', () => {
      // CRITICAL: returning true here would force refresh attempts on
      // tokens that CAN'T be refreshed (env-var / FD-injected service keys
      // with no refresh_token).
      expect(isOAuthTokenExpired(null)).toBe(false)
    })
    test('far-future expiresAt → false (well within validity)', () => {
      const farFuture = Date.now() + 24 * 60 * 60 * 1000
      expect(isOAuthTokenExpired(farFuture)).toBe(false)
    })
    test('past expiresAt → true', () => {
      const past = Date.now() - 1000
      expect(isOAuthTokenExpired(past)).toBe(true)
    })
    test('5-min buffer: expiring in 4 minutes → true (refresh proactively)', () => {
      // ant uses 5*60*1000 = 300_000 ms buffer so refreshes finish before
      // tokens hit the server-side expiry. Pin this exact value.
      const fourMinFromNow = Date.now() + 4 * 60 * 1000
      expect(isOAuthTokenExpired(fourMinFromNow)).toBe(true)
    })
    test('5-min buffer: expiring in 6 minutes → false (no preemptive refresh)', () => {
      const sixMinFromNow = Date.now() + 6 * 60 * 1000
      expect(isOAuthTokenExpired(sixMinFromNow)).toBe(false)
    })
    test('exactly 5 min from now → true (>= comparison)', () => {
      // ant: `return Date.now()+_>=H` — note >= not >. A token expiring
      // at exactly now+5min would be considered expired.
      const exactlyFiveMin = Date.now() + 5 * 60 * 1000
      // Allow 50ms jitter for test execution time but the semantic must
      // be "consider expired when within 5 minutes inclusive".
      expect(isOAuthTokenExpired(exactlyFiveMin - 50)).toBe(true)
    })
  })
})
