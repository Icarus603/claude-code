import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for refreshOAuthToken `clientId` + `expiresIn` options.
 *
 * Three real bugs found via ant 2.1.136 audit (port of `Bq_` from
 * bun-demincer/decoded/1255.js):
 *
 *  1. refreshOAuthToken used to accept ONLY `{ scopes }`. Ant accepts
 *     `{ scopes, expiresIn, clientId }`. Without clientId, every refresh
 *     reverts the token's bound OAuth client to the default — breaking
 *     custom-client integrations (e.g. Xcode).
 *
 *  2. The returned token did NOT include `clientId`. Ant returns
 *     `clientId: K` so the NEXT refresh sees this and passes it back
 *     through — keeping the custom client identity sticky across refreshes.
 *
 *  3. The periodic refresh path (`checkAndRefreshOAuthTokenIfNeeded`,
 *     port of ant `pt6` in 1997.js) didn't propagate `clientId` and
 *     misclassified the omit-scopes condition. Ant logic:
 *        scopes: (bB(w.scopes) || w.subscriptionType) && !w.clientId ? void 0 : w.scopes
 *     ccb was missing the `|| subscriptionType` branch and the
 *     `&& !clientId` guard. Both matter: pre-scope tokens needed the
 *     subscriptionType fallback; clientId-bound tokens needed scopes
 *     preserved verbatim or the custom scope set would silently revert.
 */
describe('refreshOAuthToken — clientId + expiresIn signature pins', () => {
  const clientSource = readFileSync(
    resolve(__dirname, '..', 'oauth', 'client.ts'),
    'utf-8',
  )

  test('signature accepts { scopes, expiresIn, clientId } (3-option object)', () => {
    expect(clientSource).toMatch(
      /export async function refreshOAuthToken\([\s\S]+?scopes\?: string\[\];\s*expiresIn\?: number;\s*clientId\?: string\s*\}/,
    )
  })

  test('request body client_id falls back to default ONLY when clientId arg absent', () => {
    // Pin: `clientId ?? getOauthConfig().CLIENT_ID`. Old code hardcoded
    // `getOauthConfig().CLIENT_ID`.
    expect(clientSource).toMatch(
      /client_id: clientId \?\? getOauthConfig\(\)\.CLIENT_ID/,
    )
  })

  test('request body includes expires_in ONLY when caller provides it', () => {
    // Pin: optional field add. Ant's Bq_ does `if (q !== void 0) O.expires_in = q;`
    expect(clientSource).toMatch(
      /if \(expiresIn !== undefined\) requestBody\.expires_in = expiresIn/,
    )
  })

  test('returned token includes `clientId` field', () => {
    // Pin: the field MUST be in the return object so subsequent refreshes
    // pick it up. ant's Bq_ does `clientId: K`.
    expect(clientSource).toMatch(
      /accessToken,[\s\S]+?refreshToken: newRefreshToken,[\s\S]+?expiresAt,[\s\S]+?scopes,[\s\S]+?clientId,/,
    )
  })

  test('return-shape comment references ant Bq_ rationale', () => {
    // Pin: keep the rationale visible so future refactors don't strip it.
    expect(clientSource).toMatch(
      /Port of ant v2\.1\.136 Bq_ return shape[\s\S]{0,200}?clientId/,
    )
  })

  test('signature doc references ant Bq_', () => {
    expect(clientSource).toMatch(
      /Port of ant v2\.1\.136 `Bq_` signature/,
    )
  })

  describe('pt6 caller (checkAndRefreshOAuthTokenIfNeeded)', () => {
    const authSource = readFileSync(
      resolve(__dirname, '..', 'authAlias.ts'),
      'utf-8',
    )

    test('extracts lockedSubscriptionType + lockedClientId from the token view', () => {
      // Pin: needs both extracted to compute the omit-scopes flag.
      expect(authSource).toMatch(/lockedSubscriptionType/)
      expect(authSource).toMatch(/lockedClientId/)
    })

    test('shouldOmitScopes = (claudeAI || subscriptionType) && !clientId', () => {
      // Pin: the exact ant pt6 condition. A regression that drops the
      // `|| lockedSubscriptionType` branch breaks refresh for old
      // tokens with subscriptionType but no scope marker. A regression
      // that drops `&& !lockedClientId` would clobber custom-client
      // scopes back to the default CLAUDE_AI_OAUTH_SCOPES set.
      expect(authSource).toMatch(
        /shouldOmitScopes =\s*\n?\s*\(shouldUseClaudeAIAuth\(lockedTokens\.scopes\) \|\| lockedSubscriptionType\) &&\s*\n?\s*!lockedClientId/,
      )
    })

    test('refreshOAuthToken call uses shouldOmitScopes ternary + clientId pass-through', () => {
      expect(authSource).toMatch(
        /refreshOAuthToken\(lockedTokens\.refreshToken, \{\s*\n?\s*scopes: shouldOmitScopes \? undefined : lockedTokens\.scopes,\s*\n?\s*clientId: lockedClientId,/,
      )
    })

    test('pt6 port comment references ant 1997.js bB / w.clientId logic', () => {
      // Pin: the rationale comment that explains the double-condition.
      expect(authSource).toMatch(
        /Port of ant v2\.1\.136 pt6[\s\S]{0,500}?bB\(w\.scopes\) \|\| w\.subscriptionType/,
      )
    })
  })

  describe('headless env-var login (CLAUDE_CODE_OAUTH_REFRESH_TOKEN path)', () => {
    const cliSource = readFileSync(
      resolve(__dirname, '..', '..', '..', 'cli', 'src', 'handlers', 'auth.ts'),
      'utf-8',
    )

    test('imports LONG_LIVED_OAUTH_TOKEN_TTL_SECONDS', () => {
      expect(cliSource).toMatch(
        /import \{ LONG_LIVED_OAUTH_TOKEN_TTL_SECONDS \} from '@claude-code\/provider\/oauthConstants\.js'/,
      )
    })

    test('passes expiresIn: LONG_LIVED_OAUTH_TOKEN_TTL_SECONDS', () => {
      // Pin: matches ant 3508.js: expiresIn: ffH (=31536000 = 1 year).
      // Headless login should mint a long-lived token; otherwise the
      // user has to re-set the env var every hour.
      expect(cliSource).toMatch(
        /expiresIn: LONG_LIVED_OAUTH_TOKEN_TTL_SECONDS/,
      )
    })

    test('passes clientId: process.env.CLAUDE_CODE_OAUTH_CLIENT_ID || undefined', () => {
      // Pin: matches ant 3508.js exactly.
      expect(cliSource).toMatch(
        /clientId: process\.env\.CLAUDE_CODE_OAUTH_CLIENT_ID \|\| undefined/,
      )
    })

    test('comment references ant 3508.js port reasoning', () => {
      expect(cliSource).toMatch(
        /Port of ant v2\.1\.136 \(3508\.js\)[\s\S]{0,300}?CLAUDE_CODE_OAUTH_CLIENT_ID/,
      )
    })
  })
})
