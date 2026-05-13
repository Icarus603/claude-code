import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin the 2-second timeout cap on every `security` spawn — port of ant
 * v2.1.136 bQ_ = 2000.
 *
 * Background: macOS keychain can prompt for unlock, hang in SSH sessions,
 * or be slow under load. Without a timeout, ccb's
 * `execSyncWithDefaults` default of 10 minutes would block the event loop
 * for the entire duration. The 2s cap matches ant's measured worst-case
 * for an unlocked keychain and is short enough that the UI stays
 * responsive while allowing fallback paths to take over.
 *
 * This pin protects against:
 *   1. A future refactor that drops the timeout from sync read/delete.
 *   2. A future refactor that switches to a different exec primitive
 *      without porting the timeout (e.g., back to execaSync without arg).
 */
describe('macOsKeychainStorage — 2s timeout pins', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'secureStorage', 'macOsKeychainStorage.ts'),
    'utf-8',
  )

  test('SECURITY_SPAWN_TIMEOUT_MS = 2000 (port of ant bQ_)', () => {
    // Pin: 2-second cap. ant's value, measured against keychain unlock.
    expect(source).toMatch(/SECURITY_SPAWN_TIMEOUT_MS = 2000/)
  })

  test('SECURITY_SPAWN_TIMEOUT_MS doc mentions ant v2.1.136 / bQ_', () => {
    // Pin: the rationale comment. A regression that strips the comment
    // makes the cap look arbitrary; future refactors might "tidy" it.
    expect(source).toMatch(/ant v2\.1\.136[\s\S]{0,80}?bQ_ = 2000/)
  })

  test('sync read() passes timeout to execSyncWithDefaults', () => {
    // Pin: find-generic-password call MUST have the timeout.
    expect(source).toMatch(
      /execSyncWithDefaults\(\s*\n?\s*`security find-generic-password [\s\S]+?\{ timeout: SECURITY_SPAWN_TIMEOUT_MS \}/,
    )
  })

  test('delete() passes timeout to execSyncWithDefaults', () => {
    // Pin: delete-generic-password also bounded.
    expect(source).toMatch(
      /execSyncWithDefaults\(\s*\n?\s*`security delete-generic-password [\s\S]+?\{ timeout: SECURITY_SPAWN_TIMEOUT_MS \}/,
    )
  })

  test('update() stdin path (security -i) passes timeout', () => {
    // Pin: write path via stdin.
    expect(source).toMatch(
      /execaSync\('security', \['-i'\][\s\S]+?timeout: SECURITY_SPAWN_TIMEOUT_MS/,
    )
  })

  test('update() argv fallback path passes timeout', () => {
    // Pin: write fallback path (oversize payload via argv) ALSO bounded.
    expect(source).toMatch(
      /execaSync\(\s*\n?\s*'security',[\s\S]+?'add-generic-password',[\s\S]+?timeout: SECURITY_SPAWN_TIMEOUT_MS/,
    )
  })

  test('isMacOsKeychainLocked passes timeout to show-keychain-info probe', () => {
    // Pin: the probe runs on first render call; without timeout, a hung
    // keychain blocks first paint of AssistantTextMessage.
    expect(source).toMatch(
      /execaSync\('security', \['show-keychain-info'\][\s\S]+?timeout: SECURITY_SPAWN_TIMEOUT_MS/,
    )
  })

  test('every sync security spawn passes SECURITY_SPAWN_TIMEOUT_MS', () => {
    // Pin: belt-and-braces. Verify the constant is referenced at least
    // 6 times: 1 declaration + 5 call sites (sync read, sync delete,
    // update stdin, update argv fallback, isMacOsKeychainLocked).
    // Async readAsync via execFileNoThrow currently does NOT get the
    // timeout (matches ant — async paths are not bounded; see JX1 in
    // bun-demincer 1991.js — but the upstream cache prevents the
    // unbounded path from holding work).
    const timeoutCount = (
      source.match(/SECURITY_SPAWN_TIMEOUT_MS/g) ?? []
    ).length
    expect(timeoutCount).toBeGreaterThanOrEqual(6)
  })
})
