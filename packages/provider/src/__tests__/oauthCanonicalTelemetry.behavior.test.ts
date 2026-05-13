import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin the canonical tengu_feature_ok / tengu_feature_bad / tengu_feature_sad
 * outcome events that ant fires alongside its own user-friendly
 * `tengu_oauth_*` events.
 *
 * ant uses three helpers across the OAuth code:
 *   yH(name)            → tengu_feature_ok (success)
 *   xH(name, error_code) → tengu_feature_bad (deterministic failure)
 *   G6(name, error_code) → tengu_feature_sad (timeout/network/etc)
 *
 * These feed the fleet-wide feature-health dashboards. Without them, OAuth
 * regressions are invisible to ops until users start reporting.
 *
 * Pin matrix:
 *   - exchangeCodeForTokens:  yH success + xH(invalid_code | http_error) on failure
 *   - refreshOAuthToken:      yH success + xH(invalid_grant) | G6(request_failed)
 *   - fetchAndStoreUserRoles: yH success + xH(http_error | no_account) on failure
 *   - createAndStoreApiKey:   yH success + xH(empty_response | request_failed)
 *   - pt6 lock paths:         G6(lock_timeout) | xH(lock_error) (already
 *     locked in by pt6LockTelemetry.behavior.test.ts; not duplicated here)
 */
describe('OAuth canonical feature-ok / feature-bad / feature-sad events', () => {
  const clientSource = readFileSync(
    resolve(__dirname, '..', 'oauth', 'client.ts'),
    'utf-8',
  )

  describe('exchangeCodeForTokens (ant dg6)', () => {
    test('success path fires tengu_feature_ok with feature_name="oauth_token_exchange"', () => {
      expect(clientSource).toMatch(
        /tengu_oauth_token_exchange_success[\s\S]{0,500}?logEvent\('tengu_feature_ok',[\s\S]{0,200}?feature_name:[\s\S]{0,80}?'oauth_token_exchange'/,
      )
    })

    test('non-200 fires tengu_feature_bad with reason as error_code (401 → invalid_code, else http_error)', () => {
      // Pin: feature_bad uses the SAME reason string as the failed event.
      expect(clientSource).toMatch(
        /tengu_oauth_token_exchange_failed[\s\S]{0,500}?logEvent\('tengu_feature_bad',[\s\S]{0,200}?feature_name:[\s\S]{0,80}?'oauth_token_exchange'[\s\S]{0,300}?error_code:[\s\S]{0,80}?reason/,
      )
    })
  })

  describe('refreshOAuthToken (ant Bq_)', () => {
    test('success path fires tengu_feature_ok with feature_name="oauth_token_refresh"', () => {
      expect(clientSource).toMatch(
        /tengu_oauth_token_refresh_success[\s\S]{0,500}?logEvent\('tengu_feature_ok',[\s\S]{0,200}?feature_name:[\s\S]{0,80}?'oauth_token_refresh'/,
      )
    })

    test('invalid_grant fires tengu_feature_bad (xH)', () => {
      // Pin: ant Bq_ catch — xH("oauth_token_refresh", "oauth_refresh_invalid_grant").
      // feature_bad = deterministic failure path (invalid creds).
      expect(clientSource).toMatch(
        /isInvalidGrantError\(error\)[\s\S]{0,400}?logEvent\('tengu_feature_bad',[\s\S]{0,300}?'oauth_token_refresh'[\s\S]{0,300}?'oauth_refresh_invalid_grant'/,
      )
    })

    test('non-invalid_grant fires tengu_feature_sad (G6)', () => {
      // Pin: ant Bq_ else-branch — G6("oauth_token_refresh", "oauth_refresh_request_failed").
      // feature_sad = retryable failure (timeout/network/5xx).
      expect(clientSource).toMatch(
        /\} else \{[\s\S]{0,400}?logEvent\('tengu_feature_sad',[\s\S]{0,300}?'oauth_token_refresh'[\s\S]{0,300}?'oauth_refresh_request_failed'/,
      )
    })
  })

  describe('fetchAndStoreUserRoles (ant cg6)', () => {
    test('success path fires tengu_feature_ok with feature_name="oauth_fetch_roles"', () => {
      expect(clientSource).toMatch(
        /tengu_oauth_roles_stored[\s\S]{0,500}?logEvent\('tengu_feature_ok',[\s\S]{0,200}?feature_name:[\s\S]{0,80}?'oauth_fetch_roles'/,
      )
    })

    test('http_error fires tengu_feature_bad with error_code="oauth_roles_http_error"', () => {
      expect(clientSource).toMatch(
        /'http_error'[\s\S]{0,500}?logEvent\('tengu_feature_bad',[\s\S]{0,300}?'oauth_fetch_roles'[\s\S]{0,300}?'oauth_roles_http_error'/,
      )
    })

    test('no_account fires tengu_feature_bad with error_code="oauth_roles_no_account"', () => {
      expect(clientSource).toMatch(
        /'no_account'[\s\S]{0,500}?logEvent\('tengu_feature_bad',[\s\S]{0,300}?'oauth_fetch_roles'[\s\S]{0,300}?'oauth_roles_no_account'/,
      )
    })
  })

  describe('createAndStoreApiKey (ant lg6)', () => {
    test('success path fires tengu_feature_ok with feature_name="oauth_create_api_key"', () => {
      expect(clientSource).toMatch(
        /tengu_oauth_api_key',[\s\S]{0,300}?'success'[\s\S]{0,500}?logEvent\('tengu_feature_ok',[\s\S]{0,200}?feature_name:[\s\S]{0,80}?'oauth_create_api_key'/,
      )
    })

    test('empty response fires tengu_feature_bad with error_code="oauth_api_key_empty_response"', () => {
      expect(clientSource).toMatch(
        /'empty_response'[\s\S]{0,500}?logEvent\('tengu_feature_bad',[\s\S]{0,300}?'oauth_create_api_key'[\s\S]{0,300}?'oauth_api_key_empty_response'/,
      )
    })

    test('request_failed fires tengu_feature_bad with error_code="oauth_api_key_request_failed"', () => {
      expect(clientSource).toMatch(
        /'request_failed'[\s\S]{0,500}?logEvent\('tengu_feature_bad',[\s\S]{0,300}?'oauth_create_api_key'[\s\S]{0,300}?'oauth_api_key_request_failed'/,
      )
    })
  })

  describe('Comment / port references (rationale stays visible)', () => {
    test('ant dg6 xH port comment present', () => {
      expect(clientSource).toMatch(
        /Port of ant dg6 xH\("oauth_token_exchange"/,
      )
    })

    test('ant dg6 yH port comment present', () => {
      expect(clientSource).toMatch(
        /Port of ant dg6 yH\("oauth_token_exchange"\)/,
      )
    })

    test('ant Bq_ catch port comment present (xH invalid_grant)', () => {
      expect(clientSource).toMatch(
        /Port of ant Bq_ catch: xH\("oauth_token_refresh",\s*\n?\s*\/\/ "oauth_refresh_invalid_grant"\)/,
      )
    })

    test('ant Bq_ catch port comment present (G6 request_failed)', () => {
      expect(clientSource).toMatch(
        /Port of ant Bq_ catch: G6\("oauth_token_refresh",/,
      )
    })

    test('ant cg6 yH/xH port comments present', () => {
      expect(clientSource).toMatch(
        /Port of ant cg6 yH\("oauth_fetch_roles"\)/,
      )
      expect(clientSource).toMatch(
        /Port of ant cg6 xH\("oauth_fetch_roles", "oauth_roles_http_error"\)/,
      )
      expect(clientSource).toMatch(
        /Port of ant cg6 xH\("oauth_fetch_roles", "oauth_roles_no_account"\)/,
      )
    })

    test('ant lg6 yH/xH port comments present', () => {
      expect(clientSource).toMatch(/Port of ant lg6 yH\("oauth_create_api_key"\)/)
      expect(clientSource).toMatch(
        /Port of ant lg6 xH\("oauth_create_api_key", "oauth_api_key_empty_response"\)/,
      )
      expect(clientSource).toMatch(
        /Port of ant lg6 xH\("oauth_create_api_key", "oauth_api_key_request_failed"\)/,
      )
    })
  })
})
