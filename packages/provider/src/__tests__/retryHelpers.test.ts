/**
 * Tests for withRetry pure helpers.
 *
 * getRetryDelay decides backoff for API retries — wrong math means
 * either thrashing the API (too short) or making the user wait
 * minutes for a recoverable hiccup (too long).
 *
 * parseMaxTokensContextOverflowError extracts the (input, max, limit)
 * triple from a 400 error so the runtime can shrink max_tokens and
 * retry. A regex regression here breaks recoverable context-overflow.
 *
 * is529Error detects API overload and triggers the load-shedding path.
 * A miss = the user gets a hard error instead of an automatic retry.
 */
import { APIError } from '@anthropic-ai/sdk'
import { describe, expect, test } from 'bun:test'
import {
  BASE_DELAY_MS,
  getRetryDelay,
  is529Error,
  parseMaxTokensContextOverflowError,
} from '../withRetry.js'

describe('getRetryDelay — Retry-After header takes precedence', () => {
  test('numeric Retry-After header → seconds × 1000', () => {
    expect(getRetryDelay(1, '5')).toBe(5000)
    expect(getRetryDelay(1, '60')).toBe(60_000)
  })

  test('non-numeric Retry-After (e.g., HTTP-date) falls through to backoff', () => {
    // parseInt('Wed, 21 Oct...') returns NaN → falls through.
    const result = getRetryDelay(1, 'Wed, 21 Oct 2026 07:28:00 GMT')
    // Expect backoff — at attempt=1 with default jitter, somewhere in [500, 625]
    expect(result).toBeGreaterThanOrEqual(BASE_DELAY_MS)
    expect(result).toBeLessThanOrEqual(BASE_DELAY_MS * 1.25)
  })

  test('empty Retry-After is falsy → falls through to backoff', () => {
    const result = getRetryDelay(1, '')
    expect(result).toBeGreaterThanOrEqual(BASE_DELAY_MS)
  })

  test('null Retry-After uses backoff', () => {
    const result = getRetryDelay(1, null)
    expect(result).toBeGreaterThanOrEqual(BASE_DELAY_MS)
  })

  test('undefined Retry-After uses backoff', () => {
    const result = getRetryDelay(1)
    expect(result).toBeGreaterThanOrEqual(BASE_DELAY_MS)
  })
})

describe('getRetryDelay — exponential backoff', () => {
  test('attempt 1: base=500, jitter [0, 125]', () => {
    const result = getRetryDelay(1)
    expect(result).toBeGreaterThanOrEqual(500)
    expect(result).toBeLessThanOrEqual(500 * 1.25)
  })

  test('attempt 2: base=1000, jitter [0, 250]', () => {
    const result = getRetryDelay(2)
    expect(result).toBeGreaterThanOrEqual(1000)
    expect(result).toBeLessThanOrEqual(1000 * 1.25)
  })

  test('attempt 3: base=2000', () => {
    const result = getRetryDelay(3)
    expect(result).toBeGreaterThanOrEqual(2000)
    expect(result).toBeLessThanOrEqual(2000 * 1.25)
  })

  test('attempt 6: clamped to maxDelayMs (default 32000)', () => {
    // 2^5 * 500 = 16000 (under 32000) → no clamp
    const r6 = getRetryDelay(6)
    expect(r6).toBeGreaterThanOrEqual(16_000)

    // attempt 7: 2^6 * 500 = 32000 → at clamp boundary
    const r7 = getRetryDelay(7)
    expect(r7).toBeGreaterThanOrEqual(32_000)
    expect(r7).toBeLessThanOrEqual(32_000 * 1.25)

    // attempt 100: still clamped to 32000 (+25% jitter)
    const r100 = getRetryDelay(100)
    expect(r100).toBeGreaterThanOrEqual(32_000)
    expect(r100).toBeLessThanOrEqual(32_000 * 1.25)
  })

  test('custom maxDelayMs is respected', () => {
    const r10 = getRetryDelay(10, undefined, 5_000)
    expect(r10).toBeGreaterThanOrEqual(5_000)
    expect(r10).toBeLessThanOrEqual(5_000 * 1.25)
  })

  test('jitter introduces variation — repeated calls differ', () => {
    // 100 calls at attempt=2 should produce variation due to Math.random.
    const samples = Array.from({ length: 100 }, () => getRetryDelay(2))
    const distinct = new Set(samples).size
    expect(distinct).toBeGreaterThan(50) // lots of variation
  })
})

describe('parseMaxTokensContextOverflowError', () => {
  test('canonical 400 error → parses input, max, contextLimit', () => {
    const err = new APIError(
      400,
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            'input length and `max_tokens` exceed context limit: 188059 + 20000 > 200000',
        },
      },
      'input length and `max_tokens` exceed context limit: 188059 + 20000 > 200000',
      new Headers(),
    )
    expect(parseMaxTokensContextOverflowError(err)).toEqual({
      inputTokens: 188059,
      maxTokens: 20000,
      contextLimit: 200000,
    })
  })

  test('non-400 status returns undefined', () => {
    const err = new APIError(
      500,
      {
        type: 'error',
        error: {
          type: 'api_error',
          message:
            'input length and `max_tokens` exceed context limit: 100 + 200 > 300',
        },
      },
      'input length and `max_tokens` exceed context limit: 100 + 200 > 300',
      new Headers(),
    )
    expect(parseMaxTokensContextOverflowError(err)).toBeUndefined()
  })

  test('400 error WITHOUT the canonical phrase returns undefined', () => {
    const err = new APIError(
      400,
      { type: 'error', error: { type: 'invalid_request_error', message: 'something else' } },
      'something else',
      new Headers(),
    )
    expect(parseMaxTokensContextOverflowError(err)).toBeUndefined()
  })

  test('400 error with phrase but missing numbers returns undefined', () => {
    const err = new APIError(
      400,
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'input length and `max_tokens` exceed context limit',
        },
      },
      'input length and `max_tokens` exceed context limit',
      new Headers(),
    )
    expect(parseMaxTokensContextOverflowError(err)).toBeUndefined()
  })
})

describe('is529Error', () => {
  test('plain 529 status → true', () => {
    const err = new APIError(
      529,
      { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } },
      'overloaded',
      new Headers(),
    )
    expect(is529Error(err)).toBe(true)
  })

  test('non-APIError instance → false', () => {
    expect(is529Error(new Error('overloaded'))).toBe(false)
    expect(is529Error('overloaded')).toBe(false)
    expect(is529Error(null)).toBe(false)
    expect(is529Error(undefined)).toBe(false)
  })

  test('500 with overloaded_error in message → true (SDK streaming bug workaround)', () => {
    // Documented: SDK sometimes fails to pass 529 status code during
    // streaming — fall back to message inspection.
    const err = new APIError(
      500,
      {
        type: 'error',
        error: {
          type: 'overloaded_error',
          message: 'something went wrong',
        },
      },
      '{"type":"overloaded_error"}',
      new Headers(),
    )
    expect(is529Error(err)).toBe(true)
  })

  test('400 unrelated error → false', () => {
    const err = new APIError(
      400,
      { type: 'error', error: { type: 'invalid_request_error', message: 'bad input' } },
      'bad input',
      new Headers(),
    )
    expect(is529Error(err)).toBe(false)
  })
})
