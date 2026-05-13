import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for buildAuthUrl (ant au_) + exchangeCodeForTokens (ant dg6)
 * in oauth/client.ts (1255.js).
 *
 * These are the OAuth front door — wrong query param shape causes login
 * flow to fail mysteriously (server-side validation rejects unrecognized
 * params, or rejects missing required params silently with a confusing
 * server error message).
 */
describe('buildAuthUrl + exchangeCodeForTokens (ant au_/dg6 parity)', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'oauth', 'client.ts'),
    'utf-8',
  )

  describe('buildAuthUrl (ant au_)', () => {
    const fnStart = source.indexOf('export function buildAuthUrl')
    const fnSlice = source.slice(fnStart, fnStart + 2500)

    test('selects CLAUDE_AI_AUTHORIZE_URL when loginWithClaudeAi, else CONSOLE_AUTHORIZE_URL', () => {
      expect(fnSlice).toMatch(
        /loginWithClaudeAi\s*\?\s*\n?\s*getOauthConfig\(\)\.CLAUDE_AI_AUTHORIZE_URL\s*\n?\s*:\s*getOauthConfig\(\)\.CONSOLE_AUTHORIZE_URL/,
      )
    })

    test('appends code=true (Claude Max upsell flag)', () => {
      expect(fnSlice).toMatch(/authUrl\.searchParams\.append\('code',\s*'true'\)/)
    })

    test('uses MANUAL_REDIRECT_URL when isManual, else localhost callback', () => {
      expect(fnSlice).toMatch(
        /'redirect_uri',\s*\n?\s*isManual\s*\?\s*\n?\s*getOauthConfig\(\)\.MANUAL_REDIRECT_URL\s*\n?\s*:\s*`http:\/\/localhost:\$\{port\}\/callback`/,
      )
    })

    test('inferenceOnly ⇒ CLAUDE_AI_INFERENCE_SCOPE only; else ALL_OAUTH_SCOPES', () => {
      expect(fnSlice).toMatch(
        /scopesToUse =\s*inferenceOnly\s*\?\s*\n?\s*\[CLAUDE_AI_INFERENCE_SCOPE\][\s\S]{0,80}:\s*ALL_OAUTH_SCOPES/,
      )
    })

    test('code_challenge_method is S256 (PKCE — server requires this exact string)', () => {
      expect(fnSlice).toMatch(/append\('code_challenge_method',\s*'S256'\)/)
    })

    test('optional orgUUID / login_hint / login_method appended only when present', () => {
      expect(fnSlice).toMatch(/if\s*\(orgUUID\)\s*\{[\s\S]*?append\('orgUUID',\s*orgUUID\)/)
      expect(fnSlice).toMatch(/if\s*\(loginHint\)\s*\{[\s\S]*?append\('login_hint',\s*loginHint\)/)
      expect(fnSlice).toMatch(/if\s*\(loginMethod\)\s*\{[\s\S]*?append\('login_method',\s*loginMethod\)/)
    })
  })

  describe('exchangeCodeForTokens (ant dg6)', () => {
    const fnStart = source.indexOf('export async function exchangeCodeForTokens')
    const fnSlice = source.slice(fnStart, fnStart + 3500)

    test('grant_type=authorization_code with mandatory PKCE fields', () => {
      expect(fnSlice).toMatch(/grant_type:\s*'authorization_code'/)
      expect(fnSlice).toMatch(/code:\s*authorizationCode/)
      expect(fnSlice).toMatch(/code_verifier:\s*codeVerifier/)
      expect(fnSlice).toMatch(/state,/)
    })

    test('redirect_uri matches whichever was used in buildAuthUrl (manual vs callback)', () => {
      // CRITICAL: OAuth spec requires redirect_uri in code-exchange match
      // what was used in the authorize step. A divergence here is a 400 from
      // the server with a generic message.
      expect(fnSlice).toMatch(
        /redirect_uri:\s*useManualRedirect\s*\?\s*\n?\s*getOauthConfig\(\)\.MANUAL_REDIRECT_URL\s*\n?\s*:\s*`http:\/\/localhost:\$\{port\}\/callback`/,
      )
    })

    test('expires_in only included when caller passed it (ant: if(T!==void 0))', () => {
      expect(fnSlice).toMatch(/if\s*\(expiresIn !== undefined\)\s*\{[\s\S]*?requestBody\.expires_in = expiresIn/)
    })

    test('timeout is 30000 (15s was too tight, OAuth flow has multiple backend hops)', () => {
      expect(fnSlice).toMatch(/timeout:\s*30000/)
    })

    test('non-200 status fires failure telemetry BEFORE throwing (ant xH)', () => {
      // Accommodates the refactor that hoists `const reason = ...`
      // out of the logEvent call into a local before it.
      expect(fnSlice).toMatch(
        /if\s*\(response\.status !== 200\)\s*\{[\s\S]*?logEvent\('tengu_oauth_token_exchange_failed',\s*\{[\s\S]*?(reason:[\s\S]*?|reason,[\s\S]*?)\}\)[\s\S]*?throw new Error/,
      )
    })

    test('failure reason distinguishes 401 invalid_code vs generic http_error', () => {
      expect(fnSlice).toMatch(/'oauth_exchange_invalid_code'/)
      expect(fnSlice).toMatch(/'oauth_exchange_http_error'/)
    })

    test('401 throws "Invalid authorization code" message (user-facing)', () => {
      expect(fnSlice).toMatch(
        /response\.status === 401\s*\n?\s*\?\s*'Authentication failed: Invalid authorization code'/,
      )
    })

    test('2xx fires success telemetry after the throw guard', () => {
      // ant dg6: d("tengu_oauth_token_exchange_success", {}) + yH(...).
      // ccb factored yH into the featureOk() helper; pin both fire
      // before the return.
      expect(fnSlice).toMatch(
        /logEvent\('tengu_oauth_token_exchange_success',\s*\{\}\)[\s\S]*?return response\.data/,
      )
      expect(fnSlice).toMatch(
        /featureOk\('oauth_token_exchange'\)/,
      )
    })
  })
})
