import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin canonical feature-ok / feature-sad events on /api/oauth/profile and
 * /api/claude_cli_profile fetches.
 *
 * ant 1254.js Ur() and DBq() both emit:
 *   yH("oauth_profile_fetch")             → tengu_feature_ok (success)
 *   G6("oauth_profile_fetch", error_code) → tengu_feature_sad (failure)
 *
 * Two distinct error codes:
 *   - "oauth_profile_token_failed"   for the OAuth Bearer path (Ur)
 *   - "oauth_profile_api_key_failed" for the x-api-key path (DBq)
 *
 * Dashboards group on (feature_name, error_code) so they need both
 * paths emitting the canonical event. ccb was firing only its own
 * tengu_oauth_profile_fetch_succeeded / _failed events — invisible to
 * fleet dashboards.
 */
describe('getOauthProfile canonical telemetry pins', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'oauth', 'getOauthProfile.ts'),
    'utf-8',
  )

  describe('getOauthProfileFromOauthToken (ant Ur)', () => {
    test('success path emits tengu_feature_ok feature_name="oauth_profile_fetch"', () => {
      expect(source).toMatch(
        /tengu_oauth_profile_fetch_succeeded[\s\S]{0,300}?method: 'oauth_token'[\s\S]{0,500}?logEvent\('tengu_feature_ok',[\s\S]{0,200}?feature_name:[\s\S]{0,80}?'oauth_profile_fetch'/,
      )
    })

    test('failure path emits tengu_feature_sad with error_code="oauth_profile_token_failed"', () => {
      expect(source).toMatch(
        /tengu_oauth_profile_fetch_failed[\s\S]{0,300}?method: 'oauth_token'[\s\S]{0,500}?logEvent\('tengu_feature_sad',[\s\S]{0,300}?'oauth_profile_fetch'[\s\S]{0,300}?'oauth_profile_token_failed'/,
      )
    })

    test('comment references ant 1254.js Ur() port', () => {
      expect(source).toMatch(
        /Port of ant 1254\.js Ur\(\) yH\("oauth_profile_fetch"\)/,
      )
      expect(source).toMatch(
        /Port of ant 1254\.js Ur\(\) G6\("oauth_profile_fetch", "oauth_profile_token_failed"\)/,
      )
    })
  })

  describe('getOauthProfileFromApiKey (ant DBq)', () => {
    test('success path emits tengu_feature_ok feature_name="oauth_profile_fetch"', () => {
      expect(source).toMatch(
        /tengu_oauth_profile_fetch_succeeded[\s\S]{0,300}?method: 'api_key'[\s\S]{0,500}?logEvent\('tengu_feature_ok',[\s\S]{0,200}?feature_name:[\s\S]{0,80}?'oauth_profile_fetch'/,
      )
    })

    test('failure path emits tengu_feature_sad with error_code="oauth_profile_api_key_failed"', () => {
      expect(source).toMatch(
        /tengu_oauth_profile_fetch_failed[\s\S]{0,300}?method: 'api_key'[\s\S]{0,500}?logEvent\('tengu_feature_sad',[\s\S]{0,300}?'oauth_profile_fetch'[\s\S]{0,300}?'oauth_profile_api_key_failed'/,
      )
    })

    test('comment references ant 1254.js DBq port', () => {
      expect(source).toMatch(
        /Port of ant 1254\.js yH\("oauth_profile_fetch"\)/,
      )
      expect(source).toMatch(
        /Port of ant 1254\.js G6\("oauth_profile_fetch", "oauth_profile_api_key_failed"\)/,
      )
    })
  })

  test('both paths share the same feature_name="oauth_profile_fetch"', () => {
    // Pin: dashboards group on feature_name; both endpoints must use the
    // same name so ops see the combined volume + error rate.
    const featureOkCount = (
      source.match(/tengu_feature_ok'[\s\S]{0,200}?'oauth_profile_fetch'/g) ?? []
    ).length
    const featureSadCount = (
      source.match(/tengu_feature_sad'[\s\S]{0,300}?'oauth_profile_fetch'/g) ?? []
    ).length
    expect(featureOkCount).toBe(2) // both oauth_token + api_key success paths
    expect(featureSadCount).toBe(2) // both failure paths
  })

  test('timeout matches ant: 10000 ms on both endpoints', () => {
    // Pin: ant 1254.js uses 10000 for both Ur and DBq. Anything below
    // is too tight for the /api/oauth/profile round-trip; anything
    // above blocks the UI under stalled-network conditions.
    const tenSecondCount = (source.match(/timeout: 10000/g) ?? []).length
    expect(tenSecondCount).toBe(2)
  })
})
