import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Behavior pinning for saveOAuthTokensIfNeeded vs ant SxH (1997.js).
 *
 * The full function is hard to unit-test directly because it touches the
 * keychain. These source-level checks pin the *flow invariants*:
 *   1. Skip non-Claude.ai tokens (scope filter) — never save inference-only.
 *   2. Skip tokens lacking refreshToken / expiresAt — those are bearer-only
 *      env-var or FD-injected tokens that shouldn't be persisted.
 *   3. Merge subscriptionType/rateLimitTier with prior storage on null —
 *      profile fetch can transiently fail, don't wipe a valid sub.
 *   4. Telemetry events at every decision branch.
 *   5. Cache invalidation on the success path (getClaudeAIOAuthTokens cache,
 *      betas cache, tool-schema cache).
 */
describe('saveOAuthTokensIfNeeded (ant SxH parity)', () => {
  const authAliasSource = readFileSync(
    resolve(__dirname, '..', 'authAlias.ts'),
    'utf-8',
  )

  test('non-Claude.ai scopes skip persistence with not_claude_ai event', () => {
    expect(authAliasSource).toMatch(
      /if\s*\(!shouldUseClaudeAIAuth\(tokens\.scopes\)\)[\s\S]*?logEvent\('tengu_oauth_tokens_not_claude_ai'/,
    )
  })

  test('inference-only tokens (no refreshToken/expiresAt) skip persistence', () => {
    // ant: if(!H.refreshToken||!H.expiresAt) return … inference_only
    expect(authAliasSource).toMatch(
      /if\s*\(!tokens\.refreshToken\s*\|\|\s*!tokens\.expiresAt\)[\s\S]*?logEvent\('tengu_oauth_tokens_inference_only'/,
    )
  })

  test('subscriptionType falls back to existing storage value before null', () => {
    // ant: H.subscriptionType ?? w?.subscriptionType ?? null
    expect(authAliasSource).toMatch(
      /subscriptionType:\s*\n?\s*tokens\.subscriptionType\s*\?\?\s*existingOauth\?\.subscriptionType\s*\?\?\s*null/,
    )
  })

  test('rateLimitTier falls back to existing storage value before null', () => {
    expect(authAliasSource).toMatch(
      /rateLimitTier:\s*\n?\s*tokens\.rateLimitTier\s*\?\?\s*existingOauth\?\.rateLimitTier\s*\?\?\s*null/,
    )
  })

  test('telemetry events fire for both save success and save failure', () => {
    expect(authAliasSource).toMatch(/logEvent\('tengu_oauth_tokens_saved',\s*\{\s*storageBackend\s*\}\)/)
    expect(authAliasSource).toMatch(/logEvent\('tengu_oauth_tokens_save_failed',\s*\{\s*storageBackend\s*\}\)/)
  })

  test('catch block emits tengu_oauth_tokens_save_exception with error and backend', () => {
    expect(authAliasSource).toMatch(
      /logEvent\('tengu_oauth_tokens_save_exception',\s*\{[\s\S]*?storageBackend,[\s\S]*?error:/,
    )
  })

  test('catch block returns success=false with user-visible warning', () => {
    expect(authAliasSource).toMatch(
      /return\s*\{\s*success:\s*false,\s*warning:\s*'Failed to save OAuth tokens'\s*\}/,
    )
  })

  test('post-write success path invalidates getClaudeAIOAuthTokens + betas + tool-schema caches', () => {
    expect(authAliasSource).toMatch(/getClaudeAIOAuthTokens\.cache\?\.clear\?\.\(\)/)
    expect(authAliasSource).toMatch(/clearBetasCaches\(\)/)
    expect(authAliasSource).toMatch(/clearToolSchemaCache\(\)/)
  })

  test('storageBackend is sourced from secureStorage.name (ant z=A.name)', () => {
    expect(authAliasSource).toMatch(
      /const\s+storageBackend\s*=\s*\n?\s*secureStorage\.name/,
    )
  })

  test('write order: read existing → mutate claudeAiOauth → update', () => {
    // Ensures we read existing storage BEFORE clobbering it, otherwise the
    // subscription/rateLimit fallback merge has nothing to fall back to.
    const idx = (s: string) => authAliasSource.indexOf(s)
    const readIdx = idx('const storageData = secureStorage.read()')
    const mergeIdx = idx('existingOauth?.subscriptionType')
    const updateIdx = idx('secureStorage.update(storageData)')
    expect(readIdx).toBeGreaterThan(0)
    expect(mergeIdx).toBeGreaterThan(readIdx)
    expect(updateIdx).toBeGreaterThan(mergeIdx)
  })
})
