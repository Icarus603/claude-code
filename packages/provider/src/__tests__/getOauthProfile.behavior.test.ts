import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for getOauthProfileFromOauthToken (ant Ur) and
 * getOauthProfileFromApiKey (ant DBq) in oauth/getOauthProfile.ts.
 *
 * Used by validateForceLoginOrg and the OAuth post-exchange flows to
 * fetch the authoritative org UUID + email. The ccb implementation matches
 * ant's structure but was missing the success/failure telemetry pair.
 * Adding those events lets fleet-level analytics distinguish "we tried and
 * server said no" from "we never tried" — the difference between a network
 * outage and a missing scope on the token.
 */
describe('getOauthProfile (ant Ur/DBq parity)', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'oauth', 'getOauthProfile.ts'),
    'utf-8',
  )

  test('oauth-token path hits /api/oauth/profile with Bearer + 10s timeout', () => {
    expect(source).toMatch(/`\$\{getOauthConfig\(\)\.BASE_API_URL\}\/api\/oauth\/profile`/)
    expect(source).toMatch(/Authorization:\s*`Bearer \$\{accessToken\}`/)
    expect(source).toMatch(/'Content-Type':\s*'application\/json'/)
    expect(source).toMatch(/timeout:\s*10000/)
  })

  test('api-key path hits /api/claude_cli_profile with x-api-key + anthropic-beta + accountUuid', () => {
    expect(source).toMatch(/`\$\{getOauthConfig\(\)\.BASE_API_URL\}\/api\/claude_cli_profile`/)
    expect(source).toMatch(/'x-api-key':\s*apiKey/)
    expect(source).toMatch(/'anthropic-beta':\s*OAUTH_BETA_HEADER/)
    expect(source).toMatch(/account_uuid:\s*accountUuid/)
  })

  test('api-key path requires BOTH accountUuid AND apiKey (returns undefined otherwise)', () => {
    // Without this guard, axios would send `x-api-key: undefined` or a bogus
    // empty account_uuid and the server would 400 (logged as a real error).
    expect(source).toMatch(/if\s*\(!accountUuid \|\| !apiKey\)\s*\{?\s*\n?\s*return\s*\n/)
  })

  test('both paths fire success telemetry on 2xx response (ant yH("oauth_profile_fetch"))', () => {
    expect(source).toMatch(
      /logEvent\('tengu_oauth_profile_fetch_succeeded',\s*\{\s*method:\s*'oauth_token'\s*\}\)/,
    )
    expect(source).toMatch(
      /logEvent\('tengu_oauth_profile_fetch_succeeded',\s*\{\s*method:\s*'api_key'\s*\}\)/,
    )
  })

  test('both paths fire failure telemetry in catch (ant G6 failure event)', () => {
    expect(source).toMatch(
      /logEvent\('tengu_oauth_profile_fetch_failed',\s*\{\s*method:\s*'oauth_token'\s*\}\)/,
    )
    expect(source).toMatch(
      /logEvent\('tengu_oauth_profile_fetch_failed',\s*\{\s*method:\s*'api_key'\s*\}\)/,
    )
  })

  test('failure paths also call logError to capture the error itself', () => {
    // ant TH(q) — pin the dual emission (telemetry counter + error logger).
    // Otherwise we'd have hit counts without diagnostic context.
    const oauthCatch = source.indexOf("method: 'oauth_token' })\n    logError")
    const apiKeyCatch = source.indexOf("method: 'api_key' })\n    logError")
    expect(oauthCatch).toBeGreaterThan(0)
    expect(apiKeyCatch).toBeGreaterThan(0)
  })
})
