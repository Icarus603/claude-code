import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Behavior-pinning tests for handleOAuth401Error / checkAndRefreshOAuthTokenIfNeeded.
 *
 * Because the real implementation reaches into keychain/disk/lockfile state
 * that's expensive to fake, this test pins the *implementation invariants*
 * by reading the source file rather than executing the function. The goal is
 * to catch regressions where a future refactor accidentally drops one of the
 * ant-aligned behaviors:
 *
 *   1. Disk re-read fallback when env/CCR-injected mode has no keychain refresh token
 *      (mirrors ant hX1: if(process.env.CLAUDE_CODE_OAUTH_TOKEN||Fr()){disk re-read})
 *   2. Race-detection baseline token threaded through retry recursion and post-lock
 *      check (mirrors ant pt6: T=q??O.accessToken; if(A.accessToken!==T) race_resolved)
 *   3. tengu_oauth_401_recovered_from_disk telemetry event
 *   4. setOauthTokenFromFd write-back when CCR token is adopted
 */
describe('handleOAuth401Error / checkAndRefreshOAuthTokenIfNeeded ant alignment', () => {
  const authAliasSource = readFileSync(
    resolve(__dirname, '..', 'authAlias.ts'),
    'utf-8',
  )

  test('handleOAuth401Error implements disk re-read fallback for env/CCR mode', () => {
    // The fallback only fires when keychain has NO refresh token AND we're in
    // env/CCR mode — otherwise we go straight to the keychain refresh path.
    expect(authAliasSource).toMatch(/hasEnvToken\s*=\s*!!readEnv\('CLAUDE_CODE_OAUTH_TOKEN'\)/)
    expect(authAliasSource).toMatch(/hasCcrToken\s*=\s*!!getOAuthTokenFromFileDescriptor\(\)/)
    expect(authAliasSource).toMatch(/if\s*\(hasEnvToken\s*\|\|\s*hasCcrToken\)/)
  })

  test('disk re-read adopts the on-disk token by writing back to env / FD cache', () => {
    expect(authAliasSource).toMatch(
      /process\.env\.CLAUDE_CODE_OAUTH_TOKEN\s*=\s*diskOauth\.accessToken/,
    )
    expect(authAliasSource).toMatch(
      /setOauthTokenFromFd\(diskOauth\.accessToken\)/,
    )
  })

  test('disk re-read fires the disk-recovery telemetry event', () => {
    expect(authAliasSource).toMatch(
      /logEvent\('tengu_oauth_401_recovered_from_disk',\s*\{\}\)/,
    )
  })

  test('disk re-read only triggers when on-disk token differs from the failed one', () => {
    // Defensive: if the disk token IS the failed token, recovery is bogus —
    // we'd just return success and immediately hit another 401.
    expect(authAliasSource).toMatch(
      /diskOauth\?\.accessToken\s*&&\s*diskOauth\.accessToken\s*!==\s*failedAccessToken/,
    )
  })

  test('checkAndRefreshOAuthTokenIfNeeded accepts expectedAccessToken for race-detection', () => {
    expect(authAliasSource).toMatch(
      /export function checkAndRefreshOAuthTokenIfNeeded\([\s\S]*?expectedAccessToken\?\s*:\s*string/,
    )
  })

  test('handleOAuth401Error passes failedAccessToken as expectedAccessToken on force refresh', () => {
    expect(authAliasSource).toMatch(
      /checkAndRefreshOAuthTokenIfNeeded\(0,\s*true,\s*failedAccessToken\)/,
    )
  })

  test('baselineAccessToken falls back to current access token when caller omits it', () => {
    // Mirrors ant `let T=q??O.accessToken`
    expect(authAliasSource).toMatch(
      /baselineAccessToken\s*=\s*expectedAccessToken\s*\?\?\s*tokens\.accessToken/,
    )
  })

  test('race-detection compares freshTokens.accessToken against baseline', () => {
    expect(authAliasSource).toMatch(
      /freshTokens\.accessToken\s*!==\s*baselineAccessToken/,
    )
  })

  test('post-lock race-detection compares lockedTokens.accessToken against baseline', () => {
    expect(authAliasSource).toMatch(
      /lockedTokens\.accessToken\s*!==\s*baselineAccessToken/,
    )
  })

  test('catch-side race-recovery compares currentTokens.accessToken against baseline (not expiry)', () => {
    // Pre-fix this code did `!isOAuthTokenExpired(currentTokens.expiresAt)`
    // which falsely succeeded if the SAME token happened not to have expired
    // yet. ant compares accessToken identity instead.
    expect(authAliasSource).toMatch(
      /currentTokens\.accessToken\s*!==\s*baselineAccessToken/,
    )
  })

  test('retry recursion propagates baselineAccessToken (else race-detection breaks on lock-retry)', () => {
    expect(authAliasSource).toMatch(
      /checkAndRefreshOAuthTokenIfNeededImpl\(\s*retryCount\s*\+\s*1,\s*force,\s*baselineAccessToken,?\s*\)/,
    )
  })

  test('per-token in-flight de-dup map is keyed by failed access token', () => {
    // ant: bt6 Map<string,Promise>, keyed by H (the failed token)
    expect(authAliasSource).toMatch(/pending401Handlers\s*\.get\(failedAccessToken\)/)
    expect(authAliasSource).toMatch(/pending401Handlers\s*\.set\(failedAccessToken/)
    expect(authAliasSource).toMatch(/pending401Handlers\s*\.delete\(failedAccessToken\)/)
  })
})
