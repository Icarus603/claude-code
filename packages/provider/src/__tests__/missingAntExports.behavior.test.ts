import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

import {
  __resetKnownDeadRefreshTokensForTest,
  oauthRefreshLockOptions,
  SDK_OAUTH_REFRESH_ENTRYPOINTS,
} from '../authAlias.js'

/**
 * Ant authAlias export-surface parity (1997.js f_ export list).
 *
 * These exports were missing from ccb's authAlias before this commit:
 *   - getSeatTier (ant wA9)
 *   - isEnterprisePAYGSubscriber (ant nIH)
 *   - __resetKnownDeadRefreshTokensForTest (ant vX1)
 *   - oauthRefreshLockOptions (ant YA9)
 *   - SDK_OAUTH_REFRESH_ENTRYPOINTS (ant Ft6)
 *
 * Their absence didn't crash anything because no ccb caller imported them,
 * but it broke ant-source-parity: any downstream tool (e.g. a future SDK
 * consumer, an upstream merge from ant) that imports the canonical name
 * would fail. Most are pinned at the source level since they depend on
 * app-host bindings that aren't installed in bun:test.
 */
describe('missing-ant-exports parity (authAlias 1997.js)', () => {
  const authAliasSource = readFileSync(
    resolve(__dirname, '..', 'authAlias.ts'),
    'utf-8',
  )

  test('getSeatTier exists and reads from getOauthAccountInfo?.seatTier ?? null', () => {
    expect(authAliasSource).toMatch(
      /export function getSeatTier\(\):\s*string\s*\|\s*null\s*\{[\s\S]*?return getOauthAccountInfo\(\)\?\.seatTier\s*\?\?\s*null/,
    )
  })

  test('isEnterprisePAYGSubscriber: AND of enterprise type AND enterprise_usage_based seat', () => {
    expect(authAliasSource).toMatch(
      /export function isEnterprisePAYGSubscriber\(\):\s*boolean\s*\{[\s\S]*?getSubscriptionType\(\)\s*===\s*'enterprise'\s*&&\s*\n?\s*getSeatTier\(\)\s*===\s*'enterprise_usage_based'/,
    )
  })

  test('__resetKnownDeadRefreshTokensForTest delegates to clearRefreshTokenDeadSet', () => {
    expect(typeof __resetKnownDeadRefreshTokensForTest).toBe('function')
    expect(authAliasSource).toMatch(
      /export function __resetKnownDeadRefreshTokensForTest\(\):\s*void\s*\{[\s\S]*?clearRefreshTokenDeadSet\(\)/,
    )
    // Idempotent — calling on already-empty set must not throw
    expect(() => __resetKnownDeadRefreshTokensForTest()).not.toThrow()
  })

  test('oauthRefreshLockOptions: returns ant-YA9-shaped object', () => {
    const opts = oauthRefreshLockOptions('/tmp/test-claude-dir')
    expect(opts.lockfilePath).toBe('/tmp/test-claude-dir/.oauth_refresh.lock')
    expect(opts.realpath).toBe(false)
    expect(opts.stale).toBe(10_000)
    expect(typeof opts.onCompromised).toBe('function')
  })

  test('oauthRefreshLockOptions onCompromised does not throw on Error input', () => {
    const opts = oauthRefreshLockOptions('/tmp/test-claude-dir')
    expect(() => opts.onCompromised(new Error('mock'))).not.toThrow()
  })

  test('SDK_OAUTH_REFRESH_ENTRYPOINTS exists as readonly array (ccb has no SDK)', () => {
    expect(Array.isArray(SDK_OAUTH_REFRESH_ENTRYPOINTS)).toBe(true)
    expect(SDK_OAUTH_REFRESH_ENTRYPOINTS.length).toBe(0)
  })

  test('checkAndRefreshOAuthTokenIfNeeded uses oauthRefreshLockOptions on lockfile.lock', () => {
    // Pin the wire-up: just exporting the helper without consuming it would
    // mean the lockfile would still use defaults (different lock path,
    // permanent realpath, no stale timeout) — ant YA9 only matters at the
    // consumer site.
    expect(authAliasSource).toMatch(
      /lockfile\.lock\(claudeDir,\s*oauthRefreshLockOptions\(claudeDir\)\)/,
    )
  })
})
