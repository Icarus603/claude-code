import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for the apiKeyHelper SWR cache cluster vs ant
 * VxH/HA9/MX1 (1997.js).
 *
 * apiKeyHelper is a settings-defined shell command that returns an API key
 * over stdout. Three concerns are intertwined here:
 *  1. SWR cache: return stale value immediately, refresh in background.
 *  2. Transient failure handling: ' ' sentinel signals "we tried, failed,
 *     don't fall back to OAuth this turn" (would mask config error).
 *  3. Epoch tracking: clearApiKeyHelperCache() bumps the epoch; in-flight
 *     resolves check epoch before touching shared state, so settings reload
 *     mid-flight can't clobber the newer cache.
 *
 * The trust gate inside _executeApiKeyHelper duplicates the outer
 * prefetchApiKeyFromApiKeyHelperIfSafe gate — defense-in-depth so a future
 * caller of the inner helper still gets the check.
 */
describe('apiKeyHelper SWR cache cluster (ant VxH/HA9/MX1 parity)', () => {
  const authAliasSource = readFileSync(
    resolve(__dirname, '..', 'authAlias.ts'),
    'utf-8',
  )

  test('getApiKeyFromApiKeyHelper: no helper configured ⇒ null', () => {
    const fnStart = authAliasSource.indexOf('export async function getApiKeyFromApiKeyHelper')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 200)
    expect(fnSlice).toMatch(/if\s*\(!getConfiguredApiKeyHelper\(\)\)\s*return null/)
  })

  test('fresh cache (within TTL) returns immediately without firing background refresh', () => {
    const fnStart = authAliasSource.indexOf('export async function getApiKeyFromApiKeyHelper')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 800)
    expect(fnSlice).toMatch(
      /if\s*\(Date\.now\(\) - _apiKeyHelperCache\.timestamp < ttl\)\s*\{?\s*\n?\s*return _apiKeyHelperCache\.value/,
    )
  })

  test('stale cache returns stale value AND schedules background refresh', () => {
    const fnStart = authAliasSource.indexOf('export async function getApiKeyFromApiKeyHelper')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 1200)
    // Should hand back stale via `return _apiKeyHelperCache.value` after
    // launching the background refresh.
    expect(fnSlice).toMatch(
      /if\s*\(!_apiKeyHelperInflight\)\s*\{[\s\S]*?promise:\s*_runAndCache\([\s\S]*?\)/,
    )
  })

  test('cold cache deduplicates concurrent calls via _apiKeyHelperInflight', () => {
    const fnStart = authAliasSource.indexOf('export async function getApiKeyFromApiKeyHelper')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 1500)
    expect(fnSlice).toMatch(
      /if\s*\(_apiKeyHelperInflight\)\s*return _apiKeyHelperInflight\.promise/,
    )
  })

  test('_runAndCache: epoch check prevents stale resolution clobbering newer cache', () => {
    const fnStart = authAliasSource.indexOf('async function _runAndCache')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 1500)
    expect(fnSlice).toMatch(/if\s*\(epoch !== _apiKeyHelperEpoch\)\s*return value/)
    expect(fnSlice).toMatch(/if\s*\(epoch !== _apiKeyHelperEpoch\)\s*return ' '/)
  })

  test('_runAndCache: success caches only non-null values (null indicates not configured)', () => {
    const fnStart = authAliasSource.indexOf('async function _runAndCache')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 1500)
    expect(fnSlice).toMatch(
      /if\s*\(value !== null\)\s*\{?\s*\n?\s*_apiKeyHelperCache = \{ value, timestamp: Date\.now\(\) \}/,
    )
  })

  test('SWR transient failure path: keeps stale value (NOT the " " sentinel) on bg refresh fail', () => {
    const fnStart = authAliasSource.indexOf('async function _runAndCache')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 2000)
    expect(fnSlice).toMatch(
      /if\s*\(!isCold && _apiKeyHelperCache && _apiKeyHelperCache\.value !== ' '\)/,
    )
  })

  test('cold failure (or prior-error retry) writes " " sentinel — prevents OAuth fallback', () => {
    const fnStart = authAliasSource.indexOf('async function _runAndCache')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 2000)
    expect(fnSlice).toMatch(
      /_apiKeyHelperCache = \{ value: ' ', timestamp: Date\.now\(\) \}/,
    )
  })

  test('finally: only clears inflight when epoch matches (no race with reload)', () => {
    const fnStart = authAliasSource.indexOf('async function _runAndCache')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 2000)
    expect(fnSlice).toMatch(
      /\}\s*finally\s*\{[\s\S]*?if\s*\(epoch === _apiKeyHelperEpoch\)\s*\{?\s*\n?\s*_apiKeyHelperInflight = null/,
    )
  })

  test('_executeApiKeyHelper trust gate: project/local + no trust + interactive ⇒ refuse', () => {
    const fnStart = authAliasSource.indexOf('async function _executeApiKeyHelper')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 1500)
    expect(fnSlice).toMatch(
      /if\s*\(isApiKeyHelperFromProjectOrLocalSettings\(\)\)\s*\{[\s\S]*?if\s*\(!hasTrust && !isNonInteractiveSession\)[\s\S]*?return null/,
    )
    expect(fnSlice).toMatch(/tengu_apiKeyHelper_missing_trust11/)
  })

  test('_executeApiKeyHelper: 10-minute timeout matches ant dP timeout:600000', () => {
    const fnStart = authAliasSource.indexOf('async function _executeApiKeyHelper')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 1500)
    expect(fnSlice).toMatch(/timeout:\s*10\s*\*\s*60\s*\*\s*1000/)
  })

  test('_executeApiKeyHelper: throws on failure (timeout or non-zero exit)', () => {
    const fnStart = authAliasSource.indexOf('async function _executeApiKeyHelper')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 1500)
    expect(fnSlice).toMatch(/result\.timedOut\s*\?\s*'timed out'\s*:\s*`exited \$\{result\.exitCode\}`/)
    expect(fnSlice).toMatch(/throw new Error/)
  })

  test('_executeApiKeyHelper: empty stdout is a failure (helper must produce a value)', () => {
    const fnStart = authAliasSource.indexOf('async function _executeApiKeyHelper')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 1500)
    expect(fnSlice).toMatch(/if\s*\(!stdout\)\s*\{?\s*\n?\s*throw new Error\('did not return a value'\)/)
  })

  test('getApiKeyFromApiKeyHelperCached: sync reader returns cached value without executing', () => {
    const fnStart = authAliasSource.indexOf('export function getApiKeyFromApiKeyHelperCached')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 200)
    expect(fnSlice).toMatch(/return _apiKeyHelperCache\?\.value\s*\?\?\s*null/)
  })
})
