import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for refreshOAuthToken's invalid_grant handling
 * (ccb oauth/client.ts) vs ant pt6's catch block (1997.js).
 *
 * Structural difference (ccb vs ant) we DELIBERATELY keep:
 *
 *   ant: refreshOAuthToken (Bq_) just throws. The caller pt6's catch
 *        does the dead-set add via tu_(error) check.
 *
 *   ccb: refreshOAuthToken (this file) marks dead AT the HTTP-level catch
 *        because that's where we have axios-level response visibility.
 *        The caller (checkAndRefreshOAuthTokenIfNeededImpl) is dead-set-
 *        agnostic.
 *
 * Why ccb's choice: the invalid_grant decision needs the structured
 * OAuth error body, not just the thrown Error. Inferring "is this
 * invalid_grant?" at the caller layer requires re-parsing the same
 * axios error that we already inspected here. Marking dead at the
 * throw site eliminates the duplication.
 *
 * What we MUST NOT do: also mark dead in checkAndRefreshOAuthTokenIfNeeded's
 * catch (double-marking is idempotent but wasteful and obscures the
 * single-responsibility boundary).
 */
describe('refreshOAuthToken invalid_grant wiring (vs ant pt6/Bq_)', () => {
  const clientSource = readFileSync(
    resolve(__dirname, '..', 'oauth', 'client.ts'),
    'utf-8',
  )
  const authAliasSource = readFileSync(
    resolve(__dirname, '..', 'authAlias.ts'),
    'utf-8',
  )

  test('client.ts catch fires tengu_oauth_token_refresh_failure with extracted fields', () => {
    expect(clientSource).toMatch(
      /logEvent\('tengu_oauth_token_refresh_failure',\s*\{[\s\S]*?error:[\s\S]*?\.\.\.extractOAuthErrorFields\(error\)/,
    )
  })

  test('client.ts catch calls markRefreshTokenDead only when isInvalidGrantError', () => {
    expect(clientSource).toMatch(
      /if\s*\(isInvalidGrantError\(error\)\)\s*\{[\s\S]*?markRefreshTokenDead\(refreshToken\)/,
    )
  })

  test('client.ts catch emits tengu_oauth_refresh_token_marked_dead_invalid_grant', () => {
    expect(clientSource).toMatch(
      /logEvent\('tengu_oauth_refresh_token_marked_dead_invalid_grant',\s*\{\}\)/,
    )
  })

  test('client.ts catch re-throws the original error (caller decides recovery)', () => {
    // Pre-fix tendency: swallowing the error here so the caller falls into
    // race-recovery instead of seeing the failure — wrong, because then a
    // non-invalid_grant error (network) would silently succeed.
    // The catch block must end with `throw error` to surface the failure.
    const markDeadIdx = clientSource.indexOf("markRefreshTokenDead(refreshToken)")
    const throwIdx = clientSource.indexOf('throw error', markDeadIdx)
    expect(markDeadIdx).toBeGreaterThan(0)
    expect(throwIdx).toBeGreaterThan(markDeadIdx)
    // Re-throw must be within the same catch block (no more than ~1500
    // chars away to allow the canonical tengu_feature_bad / tengu_feature_sad
    // outcome events + AnalyticsMetadata casts between the dead-set marker
    // and the throw). Anything further means there's intervening logic
    // that might swallow the throw conditionally.
    expect(throwIdx - markDeadIdx).toBeLessThan(1500)
  })

  test('authAlias.ts does NOT also call markRefreshTokenDead (single-write boundary)', () => {
    // If we accidentally added a second mark-dead site here, it'd double-log
    // tengu_oauth_refresh_token_marked_dead_invalid_grant on every failure
    // — analytics would show 2x the actual rate.
    expect(authAliasSource).not.toMatch(/markRefreshTokenDead/)
  })

  test('authAlias.ts catch is race-detection only (no dead-set responsibility)', () => {
    // Pin the comment/structure showing the caller delegates to oauth/client
    // for the mark-dead decision.
    const catchIdx = authAliasSource.indexOf('tengu_oauth_token_refresh_race_recovered')
    expect(catchIdx).toBeGreaterThan(0)
  })
})
