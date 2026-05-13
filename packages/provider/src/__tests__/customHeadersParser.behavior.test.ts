import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin getCustomHeaders parser (ANTHROPIC_CUSTOM_HEADERS env). Format is
 * curl-style: "Name: Value" with newline separation. Wrong parsing →
 * malformed headers sent (or silently dropped) → debugging black hole.
 */
describe('ANTHROPIC_CUSTOM_HEADERS parser', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'anthropic', 'client.ts'),
    'utf-8',
  )

  const fnStart = source.indexOf('function getCustomHeaders')
  const fnSlice = source.slice(fnStart, fnStart + 1500)

  test('reads ANTHROPIC_CUSTOM_HEADERS env var', () => {
    expect(fnSlice).toMatch(/readEnv\('ANTHROPIC_CUSTOM_HEADERS'\)/)
  })

  test('unset env → empty object (no spurious headers)', () => {
    expect(fnSlice).toMatch(
      /if\s*\(!customHeadersEnv\)\s*return customHeaders/,
    )
  })

  test('splits on both \\n AND \\r\\n line endings (Windows env var support)', () => {
    expect(fnSlice).toMatch(/customHeadersEnv\.split\(\/\\n\|\\r\\n\/\)/)
  })

  test('skips blank lines (.trim() empty → continue)', () => {
    expect(fnSlice).toMatch(/if\s*\(!headerString\.trim\(\)\)\s*continue/)
  })

  test('CRITICAL: uses .indexOf(":") and slice — NOT regex (prevents backtracking on long lines)', () => {
    // The doc comment specifically calls out: "avoids regex backtracking on
    // malformed long header lines". A `.match(/^([^:]+):\s*(.+)$/)` refactor
    // would silently introduce O(n²) on adversarial input.
    expect(fnSlice).toMatch(/const colonIdx = headerString\.indexOf\(':'\)/)
    expect(fnSlice).toMatch(/headerString\.slice\(0, colonIdx\)\.trim\(\)/)
    expect(fnSlice).toMatch(/headerString\.slice\(colonIdx \+ 1\)\.trim\(\)/)
  })

  test('rows without ":" silently skipped (continue, NOT throw)', () => {
    // A malformed header line shouldn't crash the entire HTTP setup.
    expect(fnSlice).toMatch(/if\s*\(colonIdx === -1\)\s*continue/)
  })

  test('empty header name silently skipped (no "{ "": "value" }")', () => {
    expect(fnSlice).toMatch(
      /if\s*\(name\)\s*\{\s*\n?\s*customHeaders\[name\] = value/,
    )
  })

  test('value trimmed (so "Foo:    bar  " produces "bar", not "    bar  ")', () => {
    // Headers with weird whitespace from copy-paste / shell unquoting.
    // Pin the trim on both name AND value.
    expect(fnSlice).toMatch(/value = headerString\.slice\(colonIdx \+ 1\)\.trim\(\)/)
  })
})
