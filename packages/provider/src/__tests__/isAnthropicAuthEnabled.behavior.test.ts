import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for isAnthropicAuthEnabled vs ant YD (1997.js) and the
 * tightly-coupled isUsing3PServices (ant vo) / is1PApiCustomer (ant j2H).
 *
 * These functions gate whether the CLI uses Bearer-token Anthropic OAuth
 * for outgoing requests. Getting the gate wrong means either:
 *  - We DON'T add OAuth header where we should ⇒ 401 from api.anthropic.com
 *  - We DO add OAuth header where we shouldn't ⇒ Bearer leaks to a 3P
 *    endpoint (Bedrock proxy, OpenAI-compat gateway, etc.) — security bug.
 *
 * Three env vars must be in the 3P-detection set:
 *  - CLAUDE_CODE_USE_BEDROCK / VERTEX / FOUNDRY (ccb has provider impls)
 *  - CLAUDE_CODE_USE_ANTHROPIC_AWS / MANTLE (ccb has NO impl but the gate
 *    is still required defensively so a mis-config doesn't leak Bearer)
 */
describe('isAnthropicAuthEnabled / 3P detection (ant YD/vo/j2H parity)', () => {
  const authAliasSource = readFileSync(
    resolve(__dirname, '..', 'authAlias.ts'),
    'utf-8',
  )

  test('--bare mode disables OAuth (ant T1 short-circuit)', () => {
    const fnStart = authAliasSource.indexOf('export function isAnthropicAuthEnabled')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 1200)
    expect(fnSlice).toMatch(/if\s*\(isBareMode\(\)\)\s*return false/)
  })

  test('ANTHROPIC_UNIX_SOCKET sets OAuth based on placeholder token presence', () => {
    const fnStart = authAliasSource.indexOf('export function isAnthropicAuthEnabled')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 1200)
    expect(fnSlice).toMatch(
      /if\s*\(readEnv\('ANTHROPIC_UNIX_SOCKET'\)\)\s*\{?\s*\n?\s*return\s+!!readEnv\('CLAUDE_CODE_OAUTH_TOKEN'\)/,
    )
  })

  test('3P detection includes ALL 5 ant env vars (BEDROCK/VERTEX/FOUNDRY/ANTHROPIC_AWS/MANTLE)', () => {
    const fnStart = authAliasSource.indexOf('export function isAnthropicAuthEnabled')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 1500)
    expect(fnSlice).toMatch(/CLAUDE_CODE_USE_BEDROCK/)
    expect(fnSlice).toMatch(/CLAUDE_CODE_USE_VERTEX/)
    expect(fnSlice).toMatch(/CLAUDE_CODE_USE_FOUNDRY/)
    expect(fnSlice).toMatch(/CLAUDE_CODE_USE_ANTHROPIC_AWS/)
    expect(fnSlice).toMatch(/CLAUDE_CODE_USE_MANTLE/)
  })

  test('3P detection also includes ccb-specific modelType/BASE_URL fences', () => {
    const fnStart = authAliasSource.indexOf('export function isAnthropicAuthEnabled')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 1500)
    expect(fnSlice).toMatch(/settings\.modelType === 'openai'/)
    expect(fnSlice).toMatch(/settings\.modelType === 'gemini'/)
    expect(fnSlice).toMatch(/OPENAI_BASE_URL/)
    expect(fnSlice).toMatch(/GEMINI_BASE_URL/)
  })

  test('external auth token / API key disables OAuth UNLESS managed (CCD/CCR) context', () => {
    const fnStart = authAliasSource.indexOf('export function isAnthropicAuthEnabled')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 2500)
    // ant: `K && !P4_()` / `T && !P4_()` — must include isManagedOAuthContext gate
    expect(fnSlice).toMatch(/hasExternalAuthToken\s*&&\s*!isManagedOAuthContext\(\)/)
    expect(fnSlice).toMatch(/hasExternalApiKey\s*&&\s*!isManagedOAuthContext\(\)/)
  })

  test('apiKeyHelper from --settings counts as external auth token', () => {
    const fnStart = authAliasSource.indexOf('export function isAnthropicAuthEnabled')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 2500)
    expect(fnSlice).toMatch(
      /hasExternalAuthToken\s*=\s*\n?\s*readEnv\('ANTHROPIC_AUTH_TOKEN'\)\s*\|\|\s*\n?\s*apiKeyHelper\s*\|\|\s*\n?\s*readEnv\('CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR'\)/,
    )
  })

  test('isUsing3PServices (ant vo) covers same 5 env vars', () => {
    const fnStart = authAliasSource.indexOf('export function isUsing3PServices')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 600)
    expect(fnSlice).toMatch(/CLAUDE_CODE_USE_BEDROCK/)
    expect(fnSlice).toMatch(/CLAUDE_CODE_USE_VERTEX/)
    expect(fnSlice).toMatch(/CLAUDE_CODE_USE_FOUNDRY/)
    expect(fnSlice).toMatch(/CLAUDE_CODE_USE_ANTHROPIC_AWS/)
    expect(fnSlice).toMatch(/CLAUDE_CODE_USE_MANTLE/)
  })

  test('is1PApiCustomer delegates 3P check to isUsing3PServices (single source of truth)', () => {
    // Pre-fix this was duplicated env-var checks that drifted from
    // isUsing3PServices when ANTHROPIC_AWS/MANTLE were added to one but not the other.
    const fnStart = authAliasSource.indexOf('export function is1PApiCustomer')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 400)
    expect(fnSlice).toMatch(/if\s*\(isUsing3PServices\(\)\)\s*return false/)
  })
})
