import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin the post-storage env var + FD-token coordination dance that ant
 * NZH (3508.js) does after SxH (storage write):
 *
 *   if (process.env.CLAUDE_CODE_OAUTH_TOKEN)
 *     if (q.success) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
 *     else process.env.CLAUDE_CODE_OAUTH_TOKEN = H.accessToken
 *   if (BsH()) A_H(q.success ? null : H.accessToken)
 *
 * Two failure modes if missing:
 *   1. Storage succeeded → env var stays set → next read prefers env var
 *      over secure storage → stale token if user later refreshes via UI.
 *   2. Storage failed → env var stays set to OLD token → entire session
 *      keeps making API calls with the dead token until process exit.
 *
 * Plus: ant calls Xw_ (logout) with `preserveInProcessTokens: true` at
 * the top of NZH. Without that, the env var/FD source is wiped DURING
 * installOAuthTokens — the new tokens can't roll forward to the env var
 * source on storage failure because the env var was already deleted.
 */
describe('installOAuthTokens env var + FD coordination (ant NZH)', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'handlers', 'auth.ts'),
    'utf-8',
  )

  const fnStart = source.indexOf('export async function installOAuthTokens')
  const fnSlice = source.slice(fnStart, fnStart + 5000)

  test('performLogout called with preserveInProcessTokens: true', () => {
    // Pin: matches ant Xw_({ ..., preserveInProcessTokens: true }).
    // Without this, env var / FD token wiped DURING the install flow.
    expect(fnSlice).toMatch(
      /performLogout\(\{[\s\S]{0,200}?preserveInProcessTokens: true/,
    )
  })

  test('comment references ant NZH 3508.js port reasoning', () => {
    expect(fnSlice).toMatch(
      /Port of ant NZH \(3508\.js\)[\s\S]{0,500}?preserveInProcessTokens/,
    )
  })

  test('post-storage: env var deleted on storage success', () => {
    // Pin: if env was set AND storage succeeded → delete env var.
    expect(fnSlice).toMatch(
      /if \(process\.env\.CLAUDE_CODE_OAUTH_TOKEN\)[\s\S]{0,300}?if \(storageResult\.success\)[\s\S]{0,200}?delete process\.env\.CLAUDE_CODE_OAUTH_TOKEN/,
    )
  })

  test('post-storage: env var REPLACED with new accessToken on storage failure', () => {
    // Pin: if env was set AND storage failed → roll forward env var so
    // current process keeps working.
    expect(fnSlice).toMatch(
      /process\.env\.CLAUDE_CODE_OAUTH_TOKEN = tokens\.accessToken/,
    )
  })

  test('FD-token coordination: only updates if prior FD token exists', () => {
    // Pin: ant's BsH() existence check before A_H. We must NOT spuriously
    // SET the FD token when none existed (changes the canonical source
    // for sessions that load FD-free).
    expect(fnSlice).toMatch(
      /if \(getOauthTokenFromFd\(\)\) \{[\s\S]{0,300}?setOauthTokenFromFd\(storageResult\.success \? null : tokens\.accessToken\)/,
    )
  })

  test('FD-token state helpers imported lazily (no top-level circular dep)', () => {
    // Pin: dynamic import inside the function so the cli barrel doesn\'t
    // eagerly pull the app-host bootstrap state module.
    expect(fnSlice).toMatch(
      /const \{ getOauthTokenFromFd, setOauthTokenFromFd \} = await import\(\s*\n?\s*'@claude-code\/app-host\/bootstrap\/state\.js'/,
    )
  })

  test('NZH ant code reference present in comment', () => {
    expect(fnSlice).toMatch(
      /Port of ant NZH \(3508\.js\) env-var \+ FD-token coordination/,
    )
  })

  test('rollback comment explains the next-refresh-retry behavior', () => {
    // Pin: documents why "set env to NEW token" is the right rollback —
    // otherwise readers might assume "restore OLD env" or "leave as-is".
    expect(fnSlice).toMatch(
      /ROLL FORWARD the env var to the new access[\s\S]{0,200}?next refresh will\s*\n?\s*\/\/\s*retry storage/,
    )
  })
})

describe('performLogout preserveInProcessTokens flag (ant Xw_)', () => {
  const source = readFileSync(
    resolve(
      __dirname,
      '..',
      '..',
      '..',
      'provider',
      'src',
      'commands',
      'logout',
      'logout.tsx',
    ),
    'utf-8',
  )

  test('signature accepts preserveInProcessTokens (defaulting to false)', () => {
    // Default value AND optional type both present in the signature.
    expect(source).toMatch(/preserveInProcessTokens = false/)
    expect(source).toMatch(/preserveInProcessTokens\?: boolean/)
  })

  test('signature comment ports ant Xw_ rationale', () => {
    expect(source).toMatch(
      /Port of ant Xw_ \(3471\.js\) `preserveInProcessTokens` flag/,
    )
  })

  test('preserveInProcessTokens=false → wipe env var + null FD token', () => {
    // Pin: ant: `if (!_) (delete process.env.CLAUDE_CODE_OAUTH_TOKEN, A_H(null))`.
    expect(source).toMatch(
      /if \(!preserveInProcessTokens\) \{[\s\S]{0,400}?delete process\.env\.CLAUDE_CODE_OAUTH_TOKEN[\s\S]{0,300}?setOauthTokenFromFd\(null\)/,
    )
  })

  test('setOauthTokenFromFd loaded via lazy import (avoids circular dep)', () => {
    expect(source).toMatch(
      /const \{ setOauthTokenFromFd \} = await import\(\s*\n?\s*'@claude-code\/app-host\/bootstrap\/state\.js'/,
    )
  })

  test('default function call (no args) still triggers wipe (matches CLI logout)', () => {
    // Pin: the function defaults preserveInProcessTokens=false so the
    // bare `performLogout()` call from `ccb logout` does the wipe.
    expect(source).toMatch(
      /performLogout\(\{[\s\S]{0,300}?preserveInProcessTokens = false/,
    )
  })
})
