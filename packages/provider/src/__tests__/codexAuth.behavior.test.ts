import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin Codex OAuth token storage + refresh invariants. Codex tokens live
 * in their own GlobalConfig field (codexOAuth) to avoid colliding with
 * Anthropic's claudeAiOauth block — pin this separation explicitly.
 *
 * Critical because:
 * - Saving Codex tokens into claudeAiOauth would corrupt the Anthropic
 *   subscription state (rate-limit tier, subscriptionType, scopes).
 * - getCodexOAuthTokens returns null on any missing field — using a
 *   partial token would 401 against /responses.
 * - Refresh-failed fallback returns the OLD token (let calls proceed
 *   until the next attempt) instead of returning null.
 */
describe('codex-auth.ts token storage invariants', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'oauth', 'codex-auth.ts'),
    'utf-8',
  )

  test('saveCodexOAuthTokens writes to "codexOAuth" field (NOT claudeAiOauth)', () => {
    // Critical separation: Codex tokens must not collide with Anthropic
    // OAuth state. Pin the namespace.
    expect(source).toMatch(/codexOAuth:\s*\{[\s\S]*?accessToken:\s*tokens\.accessToken/)
    // Must NOT write to claudeAiOauth
    const fnStart = source.indexOf('export function saveCodexOAuthTokens')
    const fnEnd = source.indexOf('\n}', fnStart) + 2
    const fnBody = source.slice(fnStart, fnEnd)
    expect(fnBody).not.toContain('claudeAiOauth')
  })

  test('saveCodexOAuthTokens preserves accountId (Codex-specific)', () => {
    // ChatGPT-account-based auth needs accountId for /responses routing.
    expect(source).toMatch(/accountId:\s*tokens\.accountId/)
  })

  test('getCodexOAuthTokens returns null on ANY missing field (no partial state)', () => {
    // Without all 4 fields, the token is unusable — return null so the
    // caller falls back to /login instead of trying to use a half-state.
    expect(source).toMatch(
      /!stored\?\.accessToken \|\|\s*\n?\s*!stored\.refreshToken \|\|\s*\n?\s*!stored\.expiresAt \|\|\s*\n?\s*!stored\.accountId/,
    )
  })

  test('checkAndRefreshCodexTokenIfNeeded: no tokens → null (lets caller force /login)', () => {
    const fnStart = source.indexOf('export async function checkAndRefreshCodexTokenIfNeeded')
    const fnSlice = source.slice(fnStart, fnStart + 800)
    expect(fnSlice).toMatch(
      /if\s*\(!tokens\)\s*return null/,
    )
  })

  test('refresh expired token: success → save + return new accessToken', () => {
    const fnStart = source.indexOf('export async function checkAndRefreshCodexTokenIfNeeded')
    const fnSlice = source.slice(fnStart, fnStart + 800)
    expect(fnSlice).toMatch(
      /const refreshed = await refreshCodexToken\(tokens\.refreshToken\)[\s\S]*?saveCodexOAuthTokens\(refreshed\)[\s\S]*?return refreshed\.accessToken/,
    )
  })

  test('refresh failed → return OLD token (not null — caller can still try)', () => {
    // Defensive: the OLD token might still work for a few minutes (clock
    // skew, server-side acceptance window). Don't block usage; let the
    // next call's 401 trigger a real /login.
    const fnStart = source.indexOf('export async function checkAndRefreshCodexTokenIfNeeded')
    const fnSlice = source.slice(fnStart, fnStart + 800)
    expect(fnSlice).toMatch(
      /catch\s*\{[\s\S]*?\/\/\s*Refresh failed[\s\S]*?return tokens\.accessToken/,
    )
  })

  test('not-expired → return current accessToken (no refresh)', () => {
    const fnStart = source.indexOf('export async function checkAndRefreshCodexTokenIfNeeded')
    const fnSlice = source.slice(fnStart, fnStart + 800)
    // Path after the isOAuthTokenExpired check returns the existing token
    expect(fnSlice).toMatch(/return tokens\.accessToken\s*\n?\s*\}/)
  })

  test('uses isOAuthTokenExpired (Anthropic shared logic, 5min buffer)', () => {
    // Pin the import — same buffer as Anthropic so the timing is consistent
    // and predictable; future "let's use a different buffer for Codex"
    // would create surprise async failures.
    expect(source).toMatch(/isOAuthTokenExpired/)
  })
})
