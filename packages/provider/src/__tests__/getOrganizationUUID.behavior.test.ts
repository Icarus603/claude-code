import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for getOrganizationUUID vs ant sV (1255.js).
 *
 * Org-UUID determines request routing (Vertex/Bedrock proxy, Cowork
 * tenancy). The three-tier lookup order is load-bearing:
 *
 *   1. CLAUDE_CODE_ORGANIZATION_UUID env var → operator override
 *   2. stored oauthAccount.organizationUuid → captured at /login
 *   3. live profile fetch → only if user:profile scope present
 *
 * ccb pre-fix skipped the env-var tier, so SDK callers (Cowork) couldn't
 * override the routing target when stored oauthAccount belonged to a
 * different org. Test pins all three tiers + ordering.
 */
describe('getOrganizationUUID (ant sV parity)', () => {
  const clientSource = readFileSync(
    resolve(__dirname, '..', 'oauth', 'client.ts'),
    'utf-8',
  )

  const fnStart = clientSource.indexOf('export async function getOrganizationUUID')
  const fnSlice = clientSource.slice(fnStart, fnStart + 2000)

  test('first tier: CLAUDE_CODE_ORGANIZATION_UUID env var wins over everything', () => {
    expect(fnSlice).toMatch(
      /readEnv\('CLAUDE_CODE_ORGANIZATION_UUID'\)[\s\S]{0,80}if\s*\(envOrgUUID\)\s*return envOrgUUID/,
    )
  })

  test('second tier: stored oauthAccount.organizationUuid avoids API call', () => {
    expect(fnSlice).toMatch(
      /globalConfig\.oauthAccount\?\.organizationUuid[\s\S]{0,150}if\s*\(orgUUID\)\s*\{?\s*\n?\s*return orgUUID/,
    )
  })

  test('third tier: live profile fetch requires user:profile scope', () => {
    // Service-key sessions hardcode scopes to ['user:inference'] only, so
    // attempting the profile fetch would 403. Pin the gate.
    expect(fnSlice).toMatch(
      /if\s*\(accessToken === undefined \|\| !hasProfileScope\(\)\)\s*\{?\s*\n?\s*return null/,
    )
    expect(fnSlice).toMatch(/await getOauthProfileFromOauthToken\(accessToken\)/)
  })

  test('three tiers appear in the right ORDER (env → stored → fetched)', () => {
    const envIdx = fnSlice.indexOf("readEnv('CLAUDE_CODE_ORGANIZATION_UUID')")
    const storedIdx = fnSlice.indexOf('globalConfig.oauthAccount?.organizationUuid')
    const fetchedIdx = fnSlice.indexOf('await getOauthProfileFromOauthToken')
    expect(envIdx).toBeGreaterThan(0)
    expect(storedIdx).toBeGreaterThan(envIdx)
    expect(fetchedIdx).toBeGreaterThan(storedIdx)
  })

  test('null fallback when no source resolves (NOT throwing — caller handles)', () => {
    // Callers chain on `if(orgUUID)` so a thrown value would crash request
    // routing instead of falling through to default-org behavior.
    expect(fnSlice).toMatch(/return null/)
  })
})
