import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for getAccountInformation vs ant CxH (1997.js).
 *
 * Used by /status (account-information display). The decision tree must
 * preserve ant's exact branching because each field gates downstream UI:
 *  - tokenSource ⇒ "Logged in via {ENV_VAR}"
 *  - subscription ⇒ "Claude Pro/Max/etc."
 *  - apiKeySource ⇒ separate "API key: {source}" line
 *  - organization ⇒ org name display (only meaningful for /login flows)
 *  - email ⇒ account email
 *
 * ant CxH structure:
 *   if(getAPIProvider !== 'firstParty') return undefined
 *   tokenSource = getAuthTokenSource().source
 *   if(tokenSource matches env-var oauth) → accountInfo.tokenSource = …
 *   else if(isClaudeAISubscriber) → accountInfo.subscription = getSubscriptionName()
 *   else (everything else, ant gates this on !== 'profile') → accountInfo.tokenSource = …
 *   apiKeyWithSource = getAnthropicApiKeyWithSource()
 *   if(apiKey) → accountInfo.apiKeySource = …
 *   if(source==='claude.ai' || apiKeySource==='/login managed key')
 *     organization from oauthAccount?.organizationName
 *     email from oauthAccount?.emailAddress
 */
describe('getAccountInformation (ant CxH parity)', () => {
  const authAliasSource = readFileSync(
    resolve(__dirname, '..', 'authAlias.ts'),
    'utf-8',
  )

  const fnStart = authAliasSource.indexOf('export function getAccountInformation')
  const fnSlice = authAliasSource.slice(fnStart, fnStart + 2000)

  test('first-party gate: non-firstParty providers get undefined', () => {
    expect(fnSlice).toMatch(/if\s*\(apiProvider\s*!==\s*'firstParty'\)\s*\{?\s*\n?\s*return undefined/)
  })

  test('env-var OAuth token sources go straight to accountInfo.tokenSource', () => {
    expect(fnSlice).toMatch(/authTokenSource === 'CLAUDE_CODE_OAUTH_TOKEN'[\s\S]*?accountInfo\.tokenSource = authTokenSource/)
    expect(fnSlice).toMatch(/'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR'/)
  })

  test('Claude.ai subscribers get subscription name, NOT token source', () => {
    // Mirrors ant `else if(Eq()) q.subscription=QQ_()` — note this is the
    // ONLY branch where we'd populate `subscription`; if we ever drop the
    // isClaudeAISubscriber check, /status loses Pro/Max display.
    expect(fnSlice).toMatch(
      /else if\s*\(isClaudeAISubscriber\(\)\)\s*\{?\s*\n?\s*accountInfo\.subscription\s*=\s*getSubscriptionName\(\)/,
    )
  })

  test('apiKey present ⇒ apiKeySource is set independently of token source', () => {
    // apiKey check is decoupled from the tokenSource if/elif/else chain because
    // both can coexist (e.g. claude.ai OAuth + apiKeyHelper for a different service).
    expect(fnSlice).toMatch(/if\s*\(apiKey\)\s*\{?\s*\n?\s*accountInfo\.apiKeySource = apiKeySource/)
  })

  test('organization populated ONLY for claude.ai or /login-managed source', () => {
    // Ant: `_==="claude.ai"||O==="/login managed key"` — any other token
    // source (env var, apiKeyHelper) we don't know the org so we MUST NOT
    // display a stale one captured before a tenant switch.
    expect(fnSlice).toMatch(
      /if\s*\(\s*\n?\s*authTokenSource === 'claude\.ai' \|\|\s*\n?\s*apiKeySource === '\/login managed key'\s*\n?\s*\)/,
    )
    expect(fnSlice).toMatch(/getOauthAccountInfo\(\)\?\.organizationName/)
  })

  test('email gated identically to organization (claude.ai or /login managed)', () => {
    expect(fnSlice).toMatch(/getOauthAccountInfo\(\)\?\.emailAddress/)
    // Email assignment requires BOTH the source check AND a truthy email
    expect(fnSlice).toMatch(
      /\(\s*authTokenSource === 'claude\.ai' \|\|\s*\n?\s*apiKeySource === '\/login managed key'\)\s*&&\s*\n?\s*email/,
    )
  })

  test('return value: UserAccountInfo (not undefined when firstParty)', () => {
    // ant returns the constructed object; if we accidentally `return undefined`
    // at the end the /status panel would just show "Account: —".
    const returnIdx = fnSlice.lastIndexOf('return accountInfo')
    expect(returnIdx).toBeGreaterThan(0)
  })

  test('tokenSource fall-through branch exists for non-Claude.ai non-env-var tokens', () => {
    // ant: third branch `else if(_!=="profile") q.tokenSource=_`.
    // ccb omits the !=='profile' gate because ccb has no profile auth, but
    // the equivalent fall-through MUST still set tokenSource for things like
    // ANTHROPIC_AUTH_TOKEN, apiKeyHelper-as-token, CCR_OAUTH_TOKEN_FILE.
    expect(fnSlice).toMatch(/else\s*\{?\s*\n?\s*accountInfo\.tokenSource = authTokenSource/)
  })
})
