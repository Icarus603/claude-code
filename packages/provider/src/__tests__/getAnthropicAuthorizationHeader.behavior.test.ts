import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin getAnthropicAuthorizationHeader private function. This builds the
 * Authorization header for non-subscriber paths.
 *
 * Priority:
 *  1. ANTHROPIC_AUTH_TOKEN env var (explicit token)
 *  2. apiKeyHelper output (via getApiKeyFromApiKeyHelper — async, may
 *     trigger the helper command if not cached)
 *
 * The token always gets wrapped as "Bearer <token>". If no source has a
 * token, returns null (caller decides what to do — typically no header set).
 */
describe('getAnthropicAuthorizationHeader (auth.ts private)', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'auth.ts'),
    'utf-8',
  )

  const fnStart = source.indexOf('async function getAnthropicAuthorizationHeader')
  const fnSlice = source.slice(fnStart, fnStart + 600)

  test('reads ANTHROPIC_AUTH_TOKEN env first (highest priority)', () => {
    expect(fnSlice).toMatch(/readEnv\('ANTHROPIC_AUTH_TOKEN'\)/)
  })

  test('falls back to apiKeyHelper (async, may trigger helper exec)', () => {
    expect(fnSlice).toMatch(
      /readEnv\('ANTHROPIC_AUTH_TOKEN'\)\s*\|\|\s*\n?\s*\(await auth\.getApiKeyFromApiKeyHelper/,
    )
  })

  test('passes context.isNonInteractiveSession to helper (gates trust check)', () => {
    // The helper's trust gate fires only for interactive sessions.
    // Non-interactive (CI) should pass through; pin the context fwd.
    expect(fnSlice).toMatch(
      /context\?\.isNonInteractiveSession \?\? false/,
    )
  })

  test('wraps token as "Bearer <token>" (no other format)', () => {
    // Server expects exact "Bearer X" format; any drift (e.g. "Token X")
    // is rejected.
    expect(fnSlice).toMatch(/`Bearer \$\{token\}`/)
  })

  test('returns null (NOT empty string) when no token source', () => {
    // Caller checks `if (header) ...`. Empty string would falsy-match
    // but might also get used as "" header value silently. Pin null.
    expect(fnSlice).toMatch(/return token \? `Bearer \$\{token\}` : null/)
  })

  test('private (NOT exported) — internal to auth.ts only', () => {
    // Pin that this stays a private function. If exported, callers might
    // start using it directly and miss the surrounding subscriber gating.
    expect(fnSlice.slice(0, 30)).not.toContain('export')
    expect(source).not.toMatch(/^export[\s\S]*?function getAnthropicAuthorizationHeader/m)
  })
})
