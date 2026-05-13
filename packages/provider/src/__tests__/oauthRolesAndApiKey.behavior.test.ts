import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for fetchAndStoreUserRoles (ant cg6) and
 * createAndStoreApiKey (ant lg6) telemetry. Both functions throw on
 * failure but ant fires structured xH events FIRST so analytics can
 * distinguish failure modes without needing to parse error strings.
 *
 * ccb was missing:
 *  - fetchAndStoreUserRoles: events for both http_error and no_account paths
 *  - createAndStoreApiKey: event for empty_response (silent null return)
 *  - createAndStoreApiKey: event for request_failed catch
 */
describe('OAuth roles + API key telemetry (ant cg6/lg6)', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'oauth', 'client.ts'),
    'utf-8',
  )

  describe('fetchAndStoreUserRoles (ant cg6)', () => {
    const fnStart = source.indexOf('export async function fetchAndStoreUserRoles')
    const fnSlice = source.slice(fnStart, fnStart + 2000)

    test('non-200 status emits telemetry BEFORE throw (ant xH http_error)', () => {
      expect(fnSlice).toMatch(
        /if\s*\(response\.status !== 200\)\s*\{[\s\S]*?logEvent\('tengu_oauth_fetch_roles_failed',\s*\{\s*reason:\s*'http_error'[\s\S]*?\}\)[\s\S]*?throw new Error/,
      )
    })

    test('missing oauthAccount emits separate telemetry reason (ant xH no_account)', () => {
      expect(fnSlice).toMatch(
        /if\s*\(!config\.oauthAccount\)\s*\{[\s\S]*?logEvent\('tengu_oauth_fetch_roles_failed',\s*\{\s*reason:\s*'no_account'\s*\}\)[\s\S]*?throw new Error/,
      )
    })

    test('success path stores organizationRole + workspaceRole + organizationName', () => {
      expect(fnSlice).toMatch(/organizationRole:\s*data\.organization_role/)
      expect(fnSlice).toMatch(/workspaceRole:\s*data\.workspace_role/)
      expect(fnSlice).toMatch(/organizationName:\s*data\.organization_name/)
    })

    test('success path emits tengu_oauth_roles_stored with org_role label', () => {
      expect(fnSlice).toMatch(
        /logEvent\('tengu_oauth_roles_stored',\s*\{[\s\S]*?org_role:[\s\S]*?data\.organization_role/,
      )
    })
  })

  describe('createAndStoreApiKey (ant lg6)', () => {
    const fnStart = source.indexOf('export async function createAndStoreApiKey')
    const fnSlice = source.slice(fnStart, fnStart + 2000)

    test('success path saves API key and emits tengu_oauth_api_key success', () => {
      expect(fnSlice).toMatch(/await saveApiKey\(apiKey\)/)
      expect(fnSlice).toMatch(
        /logEvent\('tengu_oauth_api_key',\s*\{[\s\S]*?status:[\s\S]*?'success'/,
      )
    })

    test('empty response emits telemetry (was silent null return)', () => {
      expect(fnSlice).toMatch(
        /logEvent\('tengu_oauth_create_api_key_failed',\s*\{\s*reason:\s*'empty_response'\s*\}\)[\s\S]{0,50}return null/,
      )
    })

    test('catch path emits BOTH user-error event AND structured reason event', () => {
      // The tengu_oauth_api_key event carries the user-visible error message
      // (useful for triage); the new request_failed event is the structured
      // signal used by dashboards. ant lg6 fires both.
      expect(fnSlice).toMatch(
        /catch\s*\(error\)\s*\{[\s\S]*?logEvent\('tengu_oauth_api_key',[\s\S]*?status:[\s\S]*?'failure'/,
      )
      expect(fnSlice).toMatch(
        /logEvent\('tengu_oauth_create_api_key_failed',\s*\{\s*reason:\s*'request_failed'\s*\}\)[\s\S]*?throw error/,
      )
    })
  })
})
