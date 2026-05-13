import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin pt6 (checkAndRefreshOAuthTokenIfNeeded) lock-path telemetry to
 * match ant 2.1.136 (1997.js). Two ant outcome events were missing on
 * the lock paths:
 *
 *   1. G6("oauth_token_refresh", "oauth_refresh_lock_timeout") — fired
 *      when the lock-retry budget (5 attempts) is exhausted. Maps to
 *      tengu_feature_sad. Without this, the dashboard can't distinguish
 *      "we waited 5 times and gave up" from "no refresh needed".
 *
 *   2. xH("oauth_token_refresh", "oauth_refresh_lock_error") — fired
 *      when lockfile.lock() throws for a non-ELOCKED reason (fs
 *      permission, disk full, lockfile module bug). Maps to
 *      tengu_feature_bad.
 *
 *   3. The lock-release in the finally block must NOT propagate; a
 *      failed release emits its own tengu_oauth_token_refresh_lock_release_error
 *      event and the function continues.
 */
describe('pt6 lock-path telemetry pins', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'authAlias.ts'),
    'utf-8',
  )

  test('retry-limit-reached: emits tengu_feature_sad (G6)', () => {
    // Pin: feature_name="oauth_token_refresh", error_code="oauth_refresh_lock_timeout"
    expect(source).toMatch(
      /lock_retry_limit_reached[\s\S]+?logEvent\('tengu_feature_sad', \{\s*\n?\s*feature_name:[\s\S]{0,100}?'oauth_token_refresh'[\s\S]{0,200}?error_code:[\s\S]{0,100}?'oauth_refresh_lock_timeout'/,
    )
  })

  test('non-ELOCKED lock error: emits tengu_feature_bad (xH)', () => {
    // Pin: feature_name="oauth_token_refresh", error_code="oauth_refresh_lock_error"
    expect(source).toMatch(
      /tengu_oauth_token_refresh_lock_error[\s\S]+?logEvent\('tengu_feature_bad', \{\s*\n?\s*feature_name:[\s\S]{0,100}?'oauth_token_refresh'[\s\S]{0,200}?error_code:[\s\S]{0,100}?'oauth_refresh_lock_error'/,
    )
  })

  test('finally{} wraps release() in try/catch (port-pt6 invariant)', () => {
    // Pin: release errors MUST NOT propagate. Old code: bare `await
    // release()`. New code: try { ... } catch (releaseError) {...}.
    expect(source).toMatch(
      /logEvent\('tengu_oauth_token_refresh_lock_releasing'[\s\S]+?try \{\s*\n?\s*await release\(\)\s*\n?\s*logEvent\('tengu_oauth_token_refresh_lock_released'/,
    )
  })

  test('release-error path emits tengu_oauth_token_refresh_lock_release_error', () => {
    // Pin: dedicated event so prod can distinguish "release threw" from
    // "release worked, then process exited weirdly".
    expect(source).toMatch(
      /catch \(releaseError\) \{[\s\S]+?logEvent\('tengu_oauth_token_refresh_lock_release_error'/,
    )
  })

  test('release-error event includes the error message field', () => {
    // Pin: error field allows root-cause attribution.
    expect(source).toMatch(
      /tengu_oauth_token_refresh_lock_release_error', \{\s*\n?\s*error: errorMessage\(\s*\n?\s*releaseError,/,
    )
  })

  test('comment references ant pt6 / 1997.js for lock_timeout', () => {
    // Pin: visible rationale so future refactors don't strip the event.
    expect(source).toMatch(
      /Port of ant pt6 \(1997\.js\): G6[\s\S]{0,200}?oauth_refresh_lock_timeout/,
    )
  })

  test('comment references ant pt6 / 1997.js for lock_error', () => {
    expect(source).toMatch(
      /Port of ant pt6 \(1997\.js\): xH[\s\S]{0,200}?oauth_refresh_lock_error/,
    )
  })

  test('lock_acquiring → lock_acquired → release_succeeded forms the success chain', () => {
    // Pin: monotonic progression. Acquiring before acquired, release at end.
    const acquiringIdx = source.indexOf("'tengu_oauth_token_refresh_lock_acquiring'")
    const acquiredIdx = source.indexOf("'tengu_oauth_token_refresh_lock_acquired'")
    const releasingIdx = source.indexOf("'tengu_oauth_token_refresh_lock_releasing'")
    expect(acquiringIdx).toBeGreaterThan(-1)
    expect(acquiredIdx).toBeGreaterThan(acquiringIdx)
    expect(releasingIdx).toBeGreaterThan(acquiredIdx)
  })

  test('race-resolved at three checkpoints (pre-lock, post-lock, in-catch)', () => {
    // Pin: ant pt6 detects sibling refresh in THREE places.
    // 1. Pre-lock recheck (line: after first async re-read).
    // 2. Post-lock recheck (inside try-block after lock acquired).
    // 3. In catch (race-recovered) after refreshOAuthToken throws.
    const resolvedCount = (
      source.match(/tengu_oauth_token_refresh_race_resolved/g) ?? []
    ).length
    const recoveredCount = (
      source.match(/tengu_oauth_token_refresh_race_recovered/g) ?? []
    ).length
    expect(resolvedCount).toBeGreaterThanOrEqual(2)
    expect(recoveredCount).toBeGreaterThanOrEqual(1)
  })
})
