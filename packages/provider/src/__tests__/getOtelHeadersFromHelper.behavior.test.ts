import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for getOtelHeadersFromHelper vs ant He6 (1997.js).
 *
 * Enterprise observability hook: invokes a configured shell script that
 * outputs OpenTelemetry headers (Authorization, X-Trace, etc.) used for
 * outgoing metrics/log export. Security-sensitive because:
 *  - It executes shell commands (must gate on workspace trust)
 *  - It runs frequently (must debounce; default 29min cache)
 *  - It must reject malformed output (an array or non-object would otherwise
 *    leak weird shapes into header construction)
 */
describe('getOtelHeadersFromHelper (ant He6 parity)', () => {
  const authAliasSource = readFileSync(
    resolve(__dirname, '..', 'authAlias.ts'),
    'utf-8',
  )

  const fnStart = authAliasSource.indexOf('export function getOtelHeadersFromHelper')
  const fnSlice = authAliasSource.slice(fnStart, fnStart + 3000)

  test('no helper configured ⇒ empty object (NOT throwing)', () => {
    expect(fnSlice).toMatch(/if\s*\(!otelHeadersHelper\)\s*\{?\s*\n?\s*return\s*\{\}/)
  })

  test('debounce: returns cached value when within debounce window', () => {
    expect(fnSlice).toMatch(/cachedOtelHeaders\s*&&\s*\n?\s*Date\.now\(\)\s*-\s*cachedOtelHeadersTimestamp\s*<\s*debounceMs/)
  })

  test('debounce default = 29 minutes (ant CX1 = 1_740_000 ms)', () => {
    expect(authAliasSource).toMatch(
      /DEFAULT_OTEL_HEADERS_DEBOUNCE_MS\s*=\s*29\s*\*\s*60\s*\*\s*1000/,
    )
  })

  test('debounce env-var override: CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS', () => {
    expect(fnSlice).toMatch(/CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS/)
  })

  test('trust gate: project/local helper requires accepted trust dialog', () => {
    expect(fnSlice).toMatch(
      /if\s*\(isOtelHeadersHelperFromProjectOrLocalSettings\(\)\)\s*\{[\s\S]*?if\s*\(!hasTrust\)\s*\{[\s\S]*?return\s*\{\}/,
    )
  })

  test('exec uses 30s timeout (auth service may take a while)', () => {
    expect(fnSlice).toMatch(/timeout:\s*30000/)
  })

  test('rejects non-object output (null, array, primitive)', () => {
    expect(fnSlice).toMatch(
      /typeof headers !== 'object'\s*\|\|\s*\n?\s*headers === null\s*\|\|\s*\n?\s*Array\.isArray\(headers\)/,
    )
  })

  test('rejects values that are not strings (header values must be string)', () => {
    expect(fnSlice).toMatch(
      /for\s*\(const \[key, value\] of Object\.entries\(headers\)\)\s*\{[\s\S]*?typeof value !== 'string'/,
    )
  })

  test('catch path re-throws (ant `throw q`) — caller decides how to recover', () => {
    expect(fnSlice).toMatch(
      /\}\s*catch\s*\(error\)\s*\{[\s\S]*?logError\([\s\S]*?\)\s*\n?\s*throw error/,
    )
  })

  test('cache write happens AFTER validation (else malformed result would poison cache)', () => {
    const validateIdx = fnSlice.indexOf("typeof value !== 'string'")
    const cacheWriteIdx = fnSlice.indexOf('cachedOtelHeaders = headers')
    expect(validateIdx).toBeGreaterThan(0)
    expect(cacheWriteIdx).toBeGreaterThan(validateIdx)
  })
})
