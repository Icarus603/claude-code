import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for validateForceLoginOrg vs ant I8H (1997.js).
 *
 * Critical enterprise security boundary: locks the CLI to a specific org
 * (or set of orgs) via managed policySettings. Failing this check exits
 * the CLI with an error before any tool can run.
 *
 * ant I8H structure (relevant invariants):
 *   1. ANTHROPIC_UNIX_SOCKET ⇒ skip (handled by proxy local side)
 *   2. !isAnthropicAuthEnabled ⇒ skip (3P/bare)
 *   3. policySettings.forceLoginOrgUUID undefined ⇒ skip (no policy set)
 *   4. Normalize string→[string], leave array as-is
 *   5. Empty array ⇒ FAIL (misconfiguration sentinel)
 *   6. Phrase "organization X" for single, "one of these organizations: X, Y" for many
 *   7. Refresh token before profile fetch
 *   8. profile fetch failure ⇒ FAIL closed (network error)
 *   9. profile.organization.uuid in allowed list ⇒ SUCCESS
 *  10. Mismatch + env-var token ⇒ specific message naming the env var
 *  11. Mismatch + claude.ai token ⇒ generic "log in with permitted org"
 */
describe('validateForceLoginOrg (ant I8H parity)', () => {
  const authAliasSource = readFileSync(
    resolve(__dirname, '..', 'authAlias.ts'),
    'utf-8',
  )

  const fnStart = authAliasSource.indexOf('export async function validateForceLoginOrg')
  const fnSlice = authAliasSource.slice(fnStart, fnStart + 4500)

  test('SSH-proxy ANTHROPIC_UNIX_SOCKET short-circuits to valid (proxy handles it)', () => {
    expect(fnSlice).toMatch(
      /if\s*\(readEnv\('ANTHROPIC_UNIX_SOCKET'\)\)\s*\{?\s*\n?\s*return\s*\{\s*valid:\s*true\s*\}/,
    )
  })

  test('non-Anthropic auth context (3P/bare) skips validation', () => {
    expect(fnSlice).toMatch(
      /if\s*\(!isAnthropicAuthEnabled\(\)\)\s*\{?\s*\n?\s*return\s*\{\s*valid:\s*true\s*\}/,
    )
  })

  test('no policy set ⇒ no enforcement', () => {
    expect(fnSlice).toMatch(
      /if\s*\(requiredOrgUuidRaw === undefined\)\s*\{?\s*\n?\s*return\s*\{\s*valid:\s*true\s*\}/,
    )
  })

  test('normalizes string ⇒ [string], leaves array as-is (ant typeof check)', () => {
    expect(fnSlice).toMatch(
      /typeof requiredOrgUuidRaw === 'string'\s*\?\s*\n?\s*\[requiredOrgUuidRaw\]\s*\n?\s*:\s*requiredOrgUuidRaw/,
    )
  })

  test('empty array is a misconfiguration sentinel (admin contact message)', () => {
    expect(fnSlice).toMatch(
      /if\s*\(allowedOrgUuids\.length === 0\)\s*\{[\s\S]*?valid:\s*false[\s\S]*?empty array[\s\S]*?misconfiguration/,
    )
  })

  test('error phrasing differs for single vs multiple allowed orgs', () => {
    expect(fnSlice).toMatch(
      /allowedOrgUuids\.length === 1\s*\?\s*\n?\s*`organization \$\{allowedOrgUuids\[0\]\}`\s*\n?\s*:\s*`one of these organizations:\s*\$\{allowedOrgUuids\.join\(', '\)\}`/,
    )
  })

  test('refreshes token BEFORE hitting profile endpoint (avoids 401 storm)', () => {
    const refreshIdx = fnSlice.indexOf('checkAndRefreshOAuthTokenIfNeeded')
    const profileIdx = fnSlice.indexOf('getOauthProfileFromOauthToken')
    expect(refreshIdx).toBeGreaterThan(0)
    expect(profileIdx).toBeGreaterThan(refreshIdx)
  })

  test('profile fetch failure fails CLOSED (not "valid:true")', () => {
    // The text is more revealing than the structure — pin the user-facing
    // message so we know admin instructions stay accurate.
    expect(fnSlice).toMatch(
      /if\s*\(!profile\)\s*\{[\s\S]*?valid:\s*false[\s\S]*?Unable to verify organization/,
    )
  })

  test('membership check uses Array.includes (NOT === to support multi-org)', () => {
    // Pre-fix this was `tokenOrgUuid === requiredOrgUuid` (string equality)
    // which silently broke multi-org policies — they'd always fail because
    // the comparison was against an array, never matched.
    expect(fnSlice).toMatch(/allowedOrgUuids\.includes\(tokenOrgUuid\)/)
  })

  test('env-var token mismatch names the env var (so user can unset it)', () => {
    expect(fnSlice).toMatch(
      /if\s*\(isEnvVarToken\)\s*\{[\s\S]*?envVarName\s*=[\s\S]*?CLAUDE_CODE_OAUTH_TOKEN/,
    )
  })

  test('keychain token mismatch suggests `claude auth login` (no env var to unset)', () => {
    expect(fnSlice).toMatch(
      /Please log in with a permitted organization:\s*claude auth login/,
    )
  })
})
