import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for getOauthAccountInfo vs ant o3 (1997.js):
 *
 *   function o3() {
 *     return YD() ? S_().oauthAccount : void 0
 *   }
 *
 * Invariant: returns undefined when isAnthropicAuthEnabled is false. This
 * matters because callers ladder on `accountInfo?.emailAddress` etc.,
 * and a stale account snapshot would leak terminal-user identity into 3P
 * (Bedrock/Vertex/--bare) sessions where the OAuth context doesn't apply.
 */
describe('getOauthAccountInfo (ant o3 parity)', () => {
  const authAliasSource = readFileSync(
    resolve(__dirname, '..', 'authAlias.ts'),
    'utf-8',
  )

  test('gates on isAnthropicAuthEnabled() — returns undefined otherwise', () => {
    expect(authAliasSource).toMatch(
      /export function getOauthAccountInfo\(\)[\s\S]*?return\s+isAnthropicAuthEnabled\(\)\s*\?\s*getGlobalConfig\(\)\.oauthAccount\s*:\s*undefined/,
    )
  })

  test('reads oauthAccount field from getGlobalConfig() each call (not cached)', () => {
    const fnStart = authAliasSource.indexOf('export function getOauthAccountInfo')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 250)
    // Must call getGlobalConfig() directly, not capture a stale top-level reference
    expect(fnSlice).toMatch(/getGlobalConfig\(\)\.oauthAccount/)
  })

  test('signature: zero args, returns AccountInfo | undefined (no error path)', () => {
    expect(authAliasSource).toMatch(
      /export function getOauthAccountInfo\(\):\s*AccountInfo\s*\|\s*undefined/,
    )
  })
})
