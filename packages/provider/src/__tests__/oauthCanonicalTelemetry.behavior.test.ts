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
 * ccb's oauth/client.ts factors the three patterns into local helpers
 *   featureOk / featureBad / featureSad
 * so the call sites read as one-liners. This pin file verifies (a) the
 * helpers exist and (b) each call site is wired to the right feature_name
 * and error_code.
 */
describe('OAuth canonical feature-ok / feature-bad / feature-sad events', () => {
  const clientSource = readFileSync(
    resolve(__dirname, '..', 'oauth', 'client.ts'),
    'utf-8',
  )

  describe('Helper-functions present (avoid repeated inline blocks)', () => {
    test('featureOk helper defined', () => {
      // Pin: ant 0567.js yH equivalent.
      expect(clientSource).toMatch(
        /function featureOk\([\s\S]{0,200}?logEvent\('tengu_feature_ok',[\s\S]{0,200}?feature_name:/,
      )
    })

    test('featureBad helper defined', () => {
      // Pin: ant 0567.js xH equivalent.
      expect(clientSource).toMatch(
        /function featureBad\([\s\S]{0,200}?logEvent\('tengu_feature_bad',[\s\S]{0,200}?error_code:/,
      )
    })

    test('featureSad helper defined', () => {
      // Pin: ant 0567.js G6 equivalent.
      expect(clientSource).toMatch(
        /function featureSad\([\s\S]{0,200}?logEvent\('tengu_feature_sad',[\s\S]{0,200}?error_code:/,
      )
    })
  })

  describe('exchangeCodeForTokens (ant dg6)', () => {
    test('success calls featureOk("oauth_token_exchange")', () => {
      expect(clientSource).toMatch(
        /tengu_oauth_token_exchange_success[\s\S]{0,300}?featureOk\('oauth_token_exchange'\)/,
      )
    })

    test('non-200 calls featureBad("oauth_token_exchange", reason)', () => {
      // Pin: feature_bad uses the SAME reason string as the failed event.
      expect(clientSource).toMatch(
        /tengu_oauth_token_exchange_failed[\s\S]{0,500}?featureBad\('oauth_token_exchange', reason\)/,
      )
    })
  })

  describe('refreshOAuthToken (ant Bq_)', () => {
    test('success calls featureOk("oauth_token_refresh")', () => {
      expect(clientSource).toMatch(
        /tengu_oauth_token_refresh_success[\s\S]{0,300}?featureOk\('oauth_token_refresh'\)/,
      )
    })

    test('invalid_grant calls featureBad("oauth_token_refresh", "oauth_refresh_invalid_grant")', () => {
      // Pin: ant Bq_ catch xH branch. feature_bad = deterministic (invalid creds).
      expect(clientSource).toMatch(
        /isInvalidGrantError\(error\)[\s\S]{0,400}?featureBad\('oauth_token_refresh', 'oauth_refresh_invalid_grant'\)/,
      )
    })

    test('non-invalid_grant calls featureSad("oauth_token_refresh", "oauth_refresh_request_failed")', () => {
      // Pin: ant Bq_ catch G6 branch. feature_sad = retryable (timeout/5xx).
      expect(clientSource).toMatch(
        /\} else \{[\s\S]{0,300}?featureSad\('oauth_token_refresh', 'oauth_refresh_request_failed'\)/,
      )
    })
  })

  describe('fetchAndStoreUserRoles (ant cg6)', () => {
    test('success calls featureOk("oauth_fetch_roles")', () => {
      expect(clientSource).toMatch(
        /tengu_oauth_roles_stored[\s\S]{0,400}?featureOk\('oauth_fetch_roles'\)/,
      )
    })

    test('http_error calls featureBad("oauth_fetch_roles", "oauth_roles_http_error")', () => {
      expect(clientSource).toMatch(
        /'http_error'[\s\S]{0,400}?featureBad\('oauth_fetch_roles', 'oauth_roles_http_error'\)/,
      )
    })

    test('no_account calls featureBad("oauth_fetch_roles", "oauth_roles_no_account")', () => {
      expect(clientSource).toMatch(
        /'no_account'[\s\S]{0,400}?featureBad\('oauth_fetch_roles', 'oauth_roles_no_account'\)/,
      )
    })
  })

  describe('createAndStoreApiKey (ant lg6)', () => {
    test('success calls featureOk("oauth_create_api_key")', () => {
      expect(clientSource).toMatch(
        /tengu_oauth_api_key',[\s\S]{0,300}?'success'[\s\S]{0,400}?featureOk\('oauth_create_api_key'\)/,
      )
    })

    test('empty response calls featureBad("oauth_create_api_key", "oauth_api_key_empty_response")', () => {
      expect(clientSource).toMatch(
        /'empty_response'[\s\S]{0,400}?featureBad\('oauth_create_api_key', 'oauth_api_key_empty_response'\)/,
      )
    })

    test('request_failed calls featureBad("oauth_create_api_key", "oauth_api_key_request_failed")', () => {
      expect(clientSource).toMatch(
        /'request_failed'[\s\S]{0,400}?featureBad\('oauth_create_api_key', 'oauth_api_key_request_failed'\)/,
      )
    })
  })

  describe('Comment / port references (rationale stays visible)', () => {
    test('ant dg6 xH port comment present', () => {
      expect(clientSource).toMatch(
        /ant dg6 xH\("oauth_token_exchange", reason\)/,
      )
    })

    test('ant dg6 yH port comment present', () => {
      expect(clientSource).toMatch(/ant dg6 yH/)
    })

    test('ant Bq_ catch port comment present (invalid_grant)', () => {
      // The compressed form keeps the references inline as trailing comments.
      expect(clientSource).toMatch(/ant Bq_ xH/)
    })

    test('ant Bq_ catch port comment present (request_failed)', () => {
      expect(clientSource).toMatch(/ant Bq_ G6/)
    })

    test('ant cg6 yH/xH port comments present', () => {
      expect(clientSource).toMatch(/ant cg6 yH/)
      expect(clientSource).toMatch(/oauth_roles_http_error/)
      expect(clientSource).toMatch(/oauth_roles_no_account/)
    })

    test('ant lg6 yH/xH port comments present', () => {
      expect(clientSource).toMatch(/ant lg6 yH/)
      expect(clientSource).toMatch(/oauth_api_key_empty_response/)
      expect(clientSource).toMatch(/oauth_api_key_request_failed/)
    })
  })
})
