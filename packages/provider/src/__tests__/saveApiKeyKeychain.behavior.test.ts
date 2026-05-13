import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin saveApiKey (ant ig6 in 1997.js) keychain-write contract.
 *
 * The pre-fix ccb code had THREE divergences from ant ig6 that combined to
 * a P0 bug on locked keychains:
 *
 *  1. NO timeout on execa('security', ...) → spawn could hang for the
 *     execa default (no timeout). ant uses timeout: 5000.
 *
 *  2. NO exit-code check. Because the call passed `reject: false`, execa
 *     would NOT throw on non-zero exit. The old try/catch never fired and
 *     the function silently set `savedToKeychain = true` even when
 *     security failed → config got `primaryApiKey` skipped → /login
 *     produced "Login successful" but the next request failed with no
 *     credentials.
 *
 *  3. Soft fallback to config on failure (was silently logged
 *     `tengu_api_key_saved_to_config`). ant throws with a `claude doctor`
 *     hint so the user has a concrete next step.
 *
 * This pin locks all three pieces.
 */
describe('saveApiKey — port of ant ig6', () => {
  // saveApiKey body now lives in oauth/saveApiKey.ts (split out so
  // authAlias.ts stays under the grandfather LOC budget).
  const source = readFileSync(
    resolve(__dirname, '..', 'oauth', 'saveApiKey.ts'),
    'utf-8',
  )

  // The extracted module is small enough that whole-file matching is fine.
  const fnSlice = source

  test('darwin path uses execa security -i with timeout: 5000', () => {
    // Pin: ant ig6 — Zy("security", ["-i"], { ..., timeout: 5000 }).
    // Without the timeout, a stuck CLI hangs the login flow until execa\'s
    // default (very long / none) trips.
    expect(fnSlice).toMatch(
      /execa\('security', \['-i'\], \{[\s\S]{0,300}?timeout: 5000/,
    )
  })

  test('passes reject: false so we get exitCode without throwing', () => {
    // Pin: matches ant `reject: false`. The exit-code check below
    // depends on this.
    expect(fnSlice).toMatch(
      /execa\('security', \['-i'\], \{[\s\S]{0,300}?reject: false/,
    )
  })

  test('checks result.exitCode !== 0 and throws on failure', () => {
    // Pin: this guard was MISSING. Critical for /login correctness.
    expect(fnSlice).toMatch(
      /if \(result\.exitCode !== 0\) \{[\s\S]{0,800}?throw new Error/,
    )
  })

  test('thrown error message includes stderr/stdout detail (one-line summary)', () => {
    // Pin: ant `(z.stderr || z.stdout || "").trim().replace(/\\s*\\n\\s*/g, "; ")`
    // — multi-line collapsed for readable inline display.
    expect(fnSlice).toMatch(
      /\(result\.stderr as string\) \|\| \(result\.stdout as string\)/,
    )
    expect(fnSlice).toMatch(/\.replace\(\/\\s\*\\n\\s\*\/g, '; '\)/)
  })

  test('thrown error includes `claude doctor` hint (next step for user)', () => {
    // Pin: matches ant verbatim. Without this the user sees an opaque
    // keychain error and no recovery path.
    expect(fnSlice).toMatch(
      /Run `claude doctor` to diagnose keychain access/,
    )
  })

  test('failure path emits tengu_api_key_keychain_error with the detail', () => {
    // Pin: telemetry must fire BEFORE the throw. Otherwise a process
    // that immediately exits on the error loses the event.
    expect(fnSlice).toMatch(
      /logEvent\('tengu_api_key_keychain_error',[\s\S]{0,300}?error: detail/,
    )
  })

  test('success path emits tengu_api_key_saved_to_keychain after exit-code check', () => {
    // Pin: success event only fires AFTER we verified exitCode === 0.
    expect(fnSlice).toMatch(
      /if \(result\.exitCode !== 0\)[\s\S]+?\}\s*\n?\s*\n?\s*logEvent\('tengu_api_key_saved_to_keychain'/,
    )
  })

  test('non-darwin path still emits tengu_api_key_saved_to_config', () => {
    // Pin: non-darwin fallback unchanged — falls through to config.
    expect(fnSlice).toMatch(/'tengu_api_key_saved_to_config'/)
  })

  test('comment references ant ig6 / 1997.js port reasoning', () => {
    // Pin: visible rationale so the timeout/exit-check don't get
    // refactored away as "redundant".
    expect(fnSlice).toMatch(
      /Port of ant v2\.1\.136 ig6 \(1997\.js\)/,
    )
  })
})
