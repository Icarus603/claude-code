import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

import {
  CREDENTIALS_SERVICE_SUFFIX,
  KEYCHAIN_CACHE_TTL_MS,
  clearKeychainCache,
  getUsername,
  keychainCacheState,
  primeKeychainCacheFromPrefetch,
} from '../macOsKeychainHelpers.ts'

/**
 * Pin `macOsKeychainHelpers.ts` — load-bearing for OAuth credential storage.
 * Subtle: this module is hot on macOS startup (keychainPrefetch.ts fires
 * top of main.tsx) so the WRONG bug here breaks every macOS launch.
 *
 * Pinned invariants:
 *  1. CREDENTIALS_SERVICE_SUFFIX = "-credentials". Changing this orphans
 *     every existing keychain entry. P0 to pin.
 *  2. KEYCHAIN_CACHE_TTL_MS = 30_000. Lower triggers 5.5s event-loop
 *     stalls under MCP-connector load.
 *  3. clearKeychainCache MUST bump generation AND null readInFlight (so
 *     fresh reads don't join a stale in-flight promise).
 *  4. primeKeychainCacheFromPrefetch is a NO-OP if cache already touched
 *     (sync read wins over prefetch — authoritative path).
 *  5. getUsername has a try/catch around process.env.USER and userInfo()
 *     to NEVER throw (returns 'claude-code-user' fallback).
 *  6. NO heavy imports (no execa, execFileNoThrow, execFileNoThrowPortable
 *     etc.). The whole point of this file is to avoid pulling 58ms of
 *     init into the prefetch path.
 */
describe('macOsKeychainHelpers', () => {
  describe('Constants', () => {
    test('CREDENTIALS_SERVICE_SUFFIX = "-credentials" (DO NOT CHANGE)', () => {
      // Pin: changing this orphans every stored keychain credential.
      expect(CREDENTIALS_SERVICE_SUFFIX).toBe('-credentials')
    })

    test('KEYCHAIN_CACHE_TTL_MS = 30_000 (30s — short stalls otherwise)', () => {
      // Pin: lowered TTL triggered 5.5s event-loop stalls under MCP load.
      expect(KEYCHAIN_CACHE_TTL_MS).toBe(30_000)
    })
  })

  describe('clearKeychainCache invariant', () => {
    test('zeros cache; bumps generation; nulls readInFlight', () => {
      // Setup: simulate dirty state.
      keychainCacheState.cache = {
        data: { primaryApiKey: 'x' } as never,
        cachedAt: Date.now(),
      }
      const genBefore = keychainCacheState.generation
      keychainCacheState.readInFlight = Promise.resolve(null)

      clearKeychainCache()

      expect(keychainCacheState.cache.data).toBeNull()
      expect(keychainCacheState.cache.cachedAt).toBe(0)
      // Pin: generation MUST be strictly higher (cancels stale subprocess
      // writes that captured the prior generation).
      expect(keychainCacheState.generation).toBeGreaterThan(genBefore)
      // Pin: readInFlight cleared so concurrent reads start fresh.
      expect(keychainCacheState.readInFlight).toBeNull()
    })
  })

  describe('primeKeychainCacheFromPrefetch', () => {
    test('NO-OP if cache already populated (sync read wins)', () => {
      // Simulate: sync read already populated.
      const now = Date.now()
      keychainCacheState.cache = {
        data: { primaryApiKey: 'real-key' } as never,
        cachedAt: now,
      }
      primeKeychainCacheFromPrefetch('{"primaryApiKey":"prefetch-key"}')
      // Cache untouched.
      expect(
        (keychainCacheState.cache.data as { primaryApiKey: string }).primaryApiKey,
      ).toBe('real-key')
      expect(keychainCacheState.cache.cachedAt).toBe(now)
    })

    test('null stdout → cache populated with data: null at current time', () => {
      // Pin: null stdout means "keychain returned nothing" (not "skip me").
      // Cache must reflect this so subsequent reads don't re-spawn.
      keychainCacheState.cache = { data: null, cachedAt: 0 }
      primeKeychainCacheFromPrefetch(null)
      expect(keychainCacheState.cache.data).toBeNull()
      expect(keychainCacheState.cache.cachedAt).toBeGreaterThan(0)
    })

    test('valid JSON stdout → parsed into cache.data', () => {
      keychainCacheState.cache = { data: null, cachedAt: 0 }
      primeKeychainCacheFromPrefetch('{"primaryApiKey":"k1"}')
      expect(
        (keychainCacheState.cache.data as { primaryApiKey: string }).primaryApiKey,
      ).toBe('k1')
    })

    test('malformed JSON → silent return (cache untouched)', () => {
      // Pin: parse failure must NOT throw. Sync read() re-fetches.
      keychainCacheState.cache = { data: null, cachedAt: 0 }
      primeKeychainCacheFromPrefetch('{ not valid json')
      // cachedAt stays 0 = invalid; sync read() will re-fetch.
      expect(keychainCacheState.cache.cachedAt).toBe(0)
    })
  })

  describe('getUsername', () => {
    test('returns a non-empty string (env or os.userInfo or fallback)', () => {
      const name = getUsername()
      expect(typeof name).toBe('string')
      expect(name.length).toBeGreaterThan(0)
    })

    test('falls back to "claude-code-user" when both env+userInfo fail', () => {
      // Hard to simulate userInfo crash in unit test; verify source has
      // the literal fallback so we don't accidentally remove it.
      const source = readFileSync(
        resolve(__dirname, '..', 'macOsKeychainHelpers.ts'),
        'utf-8',
      )
      expect(source).toMatch(/return 'claude-code-user'/)
    })
  })
})

describe('macOsKeychainHelpers — source pins', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'macOsKeychainHelpers.ts'),
    'utf-8',
  )

  test('does NOT import execa (would defeat keychainPrefetch optimisation)', () => {
    // Pin: see file header. execa import alone is ~58ms.
    expect(source).not.toMatch(/^import [\s\S]+? from ['"]execa['"]/m)
  })

  test('does NOT import execFileNoThrow (same reason)', () => {
    // Pin: only fails if execFileNoThrow appears in an import statement
    // (the doc-comment reference to "execFileNoThrow" is expected and fine).
    expect(source).not.toMatch(
      /^import [\s\S]+?execFileNoThrow[\s\S]+? from /m,
    )
  })

  test('keychainCacheState exports a MUTABLE object (let-bind workaround)', () => {
    // Pin: ES modules can't have writable cross-module `let` exports —
    // an object IS the workaround for sharing mutable state with
    // macOsKeychainStorage.ts. Don't refactor to individual exports.
    expect(source).toMatch(
      /export const keychainCacheState:\s*\{[\s\S]+?\}/,
    )
  })

  test('keychainCacheState.cache initial cachedAt = 0 (= invalid)', () => {
    expect(source).toMatch(
      /keychainCacheState:[\s\S]+?cache: \{ data: null, cachedAt: 0 \}/,
    )
  })

  test('getMacOsKeychainStorageServiceName uses SHA256 of configDir (first 8 chars)', () => {
    // Pin: hash-truncate keeps the service-name length manageable while
    // still uniquely identifying a config dir. SHA256 (not MD5) because
    // it\'s the one already loaded by startupProfiler.
    expect(source).toMatch(
      /createHash\('sha256'\)\.update\(configDir\)\.digest\('hex'\)\.substring\(0, 8\)/,
    )
  })

  test('default config dir → NO suffix appended (backwards compat)', () => {
    // Pin: existing keychain entries don't have a dir-hash suffix.
    // A regression that adds one would orphan them.
    expect(source).toMatch(
      /const isDefaultDir = !process\.env\.CLAUDE_CONFIG_DIR/,
    )
    expect(source).toMatch(
      /const dirHash = isDefaultDir\s*\n?\s*\?\s*''/,
    )
  })
})
