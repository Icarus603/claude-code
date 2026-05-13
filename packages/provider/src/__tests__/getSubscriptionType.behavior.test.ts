import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level invariant pinning for getSubscriptionType vs ant l7 (1997.js):
 *
 *   function l7() {
 *     if(JBq()) return wBq();        // mock subscription (test-only)
 *     if(!YD()) return null;          // !isAnthropicAuthEnabled
 *     let H = vq();                   // getClaudeAIOAuthTokens
 *     if(!H) return null;
 *     return H.subscriptionType ?? null
 *   }
 *
 * Each guard is load-bearing:
 *  - Mock override MUST come first so test fixtures can override even on
 *    sessions that wouldn't otherwise have OAuth (e.g. API-key-only repl).
 *  - isAnthropicAuthEnabled() filters out 3P (Bedrock/Vertex), --bare, and
 *    SSH-proxy contexts where the OAuth token semantics don't apply.
 *  - Fallback to null on missing tokens (NOT throwing) — callers ladder on
 *    `subscriptionType === 'max'` etc. and a thrown value would crash REPL.
 */
describe('getSubscriptionType (ant l7 parity)', () => {
  const authAliasSource = readFileSync(
    resolve(__dirname, '..', 'authAlias.ts'),
    'utf-8',
  )

  test('mock subscription override is the FIRST branch (test fixtures must win)', () => {
    const fnStart = authAliasSource.indexOf('export function getSubscriptionType')
    expect(fnStart).toBeGreaterThan(0)
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 600)
    // Mock check should appear before the auth-enabled check
    const mockIdx = fnSlice.indexOf('shouldUseMockSubscription')
    const authEnabledIdx = fnSlice.indexOf('isAnthropicAuthEnabled')
    expect(mockIdx).toBeGreaterThan(0)
    expect(authEnabledIdx).toBeGreaterThan(0)
    expect(mockIdx).toBeLessThan(authEnabledIdx)
  })

  test('returns null on !isAnthropicAuthEnabled (not throwing)', () => {
    expect(authAliasSource).toMatch(
      /export function getSubscriptionType[\s\S]{0,400}?if\s*\(!isAnthropicAuthEnabled\(\)\)\s*\{?\s*\n?\s*return null/,
    )
  })

  test('returns null when getClaudeAIOAuthTokens returns null/undefined', () => {
    expect(authAliasSource).toMatch(
      /const oauthTokens = getClaudeAIOAuthTokens\(\)\s*\n\s*if\s*\(!oauthTokens\)/,
    )
  })

  test('final return uses ?? null fallback (not || which would coerce empty string)', () => {
    // ant: H.subscriptionType ?? null  (NOT || null — distinguishes "" from null)
    expect(authAliasSource).toMatch(
      /return oauthTokens\.subscriptionType\s*\?\?\s*null/,
    )
  })
})
