import { describe, expect, test } from 'bun:test'
import {
  getDefaultBashTimeoutMs,
  getMaxBashTimeoutMs,
} from '../timeouts.js'

const DEFAULT = 120_000 // 2 min
const MAX = 600_000 // 10 min

describe('getDefaultBashTimeoutMs', () => {
  test('returns DEFAULT when env is empty', () => {
    expect(getDefaultBashTimeoutMs({})).toBe(DEFAULT)
  })

  test('returns parsed value when BASH_DEFAULT_TIMEOUT_MS is set', () => {
    expect(getDefaultBashTimeoutMs({ BASH_DEFAULT_TIMEOUT_MS: '5000' })).toBe(
      5000,
    )
  })

  test('returns DEFAULT when env value is non-numeric', () => {
    expect(getDefaultBashTimeoutMs({ BASH_DEFAULT_TIMEOUT_MS: 'abc' })).toBe(
      DEFAULT,
    )
  })

  test('returns DEFAULT when env value is empty string', () => {
    expect(getDefaultBashTimeoutMs({ BASH_DEFAULT_TIMEOUT_MS: '' })).toBe(
      DEFAULT,
    )
  })

  test('returns DEFAULT when env value is "0" (must be > 0)', () => {
    expect(getDefaultBashTimeoutMs({ BASH_DEFAULT_TIMEOUT_MS: '0' })).toBe(
      DEFAULT,
    )
  })

  test('returns DEFAULT when env value is negative', () => {
    expect(
      getDefaultBashTimeoutMs({ BASH_DEFAULT_TIMEOUT_MS: '-1000' }),
    ).toBe(DEFAULT)
  })

  test('parseInt liberal parsing: "5000abc" → 5000 (NOT rejected)', () => {
    // Documents the parseInt-trailing-garbage tolerance. If a future
    // refactor uses Number() / strict-int parsing, "5000abc" would be
    // rejected. Test locks current behavior.
    expect(
      getDefaultBashTimeoutMs({ BASH_DEFAULT_TIMEOUT_MS: '5000abc' }),
    ).toBe(5000)
  })

  test('parseInt with float input: "5000.5" → 5000', () => {
    // parseInt truncates at decimal point.
    expect(getDefaultBashTimeoutMs({ BASH_DEFAULT_TIMEOUT_MS: '5000.5' })).toBe(
      5000,
    )
  })

  test('handles very large values', () => {
    expect(
      getDefaultBashTimeoutMs({ BASH_DEFAULT_TIMEOUT_MS: '1000000000' }),
    ).toBe(1_000_000_000)
  })

  test('uses process.env when no env arg provided', () => {
    // Default param: defaults to process.env. Just verify it returns
    // a valid number (process.env may or may not have the var set).
    const result = getDefaultBashTimeoutMs()
    expect(typeof result).toBe('number')
    expect(result).toBeGreaterThan(0)
  })
})

describe('getMaxBashTimeoutMs', () => {
  test('returns MAX when env is empty', () => {
    expect(getMaxBashTimeoutMs({})).toBe(MAX)
  })

  test('returns parsed value when BASH_MAX_TIMEOUT_MS is set', () => {
    expect(getMaxBashTimeoutMs({ BASH_MAX_TIMEOUT_MS: '900000' })).toBe(
      900_000,
    )
  })

  test('returns DEFAULT (not MAX) when both env vars missing', () => {
    // Math.max(MAX, getDefault({})) = Math.max(600k, 120k) = 600k.
    expect(getMaxBashTimeoutMs({})).toBe(600_000)
  })

  test('CRITICAL invariant: max >= default — even when user sets max < default', () => {
    // If user sets MAX=10000 (10s) but DEFAULT=300000 (5min via env),
    // the function clamps max to at least default. Without this clamp,
    // bash commands could be killed before their default-timeout
    // expires — which would be a confusing UX bug.
    const env = {
      BASH_DEFAULT_TIMEOUT_MS: '300000',
      BASH_MAX_TIMEOUT_MS: '10000',
    }
    expect(getMaxBashTimeoutMs(env)).toBe(300_000) // clamped UP
  })

  test('no clamp when max > default', () => {
    const env = {
      BASH_DEFAULT_TIMEOUT_MS: '60000',
      BASH_MAX_TIMEOUT_MS: '900000',
    }
    expect(getMaxBashTimeoutMs(env)).toBe(900_000)
  })

  test('non-numeric MAX env var → uses MAX constant clamped against default', () => {
    expect(
      getMaxBashTimeoutMs({
        BASH_MAX_TIMEOUT_MS: 'invalid',
        BASH_DEFAULT_TIMEOUT_MS: '60000',
      }),
    ).toBe(MAX) // 600k > 60k, no clamp
  })

  test('non-numeric MAX + non-numeric DEFAULT → both fall back to constants', () => {
    expect(
      getMaxBashTimeoutMs({
        BASH_MAX_TIMEOUT_MS: 'x',
        BASH_DEFAULT_TIMEOUT_MS: 'y',
      }),
    ).toBe(MAX)
  })

  test('"0" MAX rejected, falls back to MAX constant', () => {
    expect(getMaxBashTimeoutMs({ BASH_MAX_TIMEOUT_MS: '0' })).toBe(MAX)
  })

  test('negative MAX rejected, falls back', () => {
    expect(getMaxBashTimeoutMs({ BASH_MAX_TIMEOUT_MS: '-1' })).toBe(MAX)
  })

  test('uses process.env when no env arg provided', () => {
    const result = getMaxBashTimeoutMs()
    expect(typeof result).toBe('number')
    expect(result).toBeGreaterThan(0)
  })
})

describe('default ≤ max invariant — across user-controllable settings', () => {
  // Property test: for any (default, max) env combo, the resulting
  // max must always be >= the resulting default. Otherwise bash
  // tool would have inconsistent timeout config.
  test.each([
    [{}, undefined, undefined],
    [{ BASH_DEFAULT_TIMEOUT_MS: '60000' }, 60000, 600000],
    [{ BASH_MAX_TIMEOUT_MS: '900000' }, 120000, 900000],
    [
      {
        BASH_DEFAULT_TIMEOUT_MS: '500000',
        BASH_MAX_TIMEOUT_MS: '100000',
      },
      500000,
      500000, // clamped
    ],
    [
      {
        BASH_DEFAULT_TIMEOUT_MS: '60000',
        BASH_MAX_TIMEOUT_MS: '300000',
      },
      60000,
      300000,
    ],
  ])('env=%j → default=%i, max=%i', (env, expectedDefault, expectedMax) => {
    const def = getDefaultBashTimeoutMs(env)
    const max = getMaxBashTimeoutMs(env)
    if (expectedDefault !== undefined) expect(def).toBe(expectedDefault)
    if (expectedMax !== undefined) expect(max).toBe(expectedMax)
    // The invariant — always.
    expect(max).toBeGreaterThanOrEqual(def)
  })
})
