import { describe, expect, test } from 'bun:test'

import {
  CannotRetryError,
  FallbackTriggeredError,
  getRetryDelay,
  is529Error,
  parseMaxTokensContextOverflowError,
} from '../withRetry.js'
import { APIError } from '@anthropic-ai/sdk'

/**
 * Behavior tests for withRetry classification helpers. These are pure
 * functions; direct-call tests catch regressions in retry decisions that
 * would otherwise only surface as 5xx loops or premature give-ups under
 * real load.
 */
describe('withRetry classification + delay (vs ant retry policy)', () => {
  describe('is529Error', () => {
    test('non-APIError → false (e.g., plain Error from network layer)', () => {
      expect(is529Error(new Error('boom'))).toBe(false)
    })

    test('APIError with status 529 → true', () => {
      const err = new APIError(529, undefined, 'overloaded', new Headers())
      expect(is529Error(err)).toBe(true)
    })

    test('APIError without 529 status but containing overloaded_error in body → true', () => {
      // The SDK sometimes drops the 529 status during streaming and only
      // surfaces the error body. Pin this fallback so we don't lose the
      // capacity-back-off behavior on streaming overloads.
      const err = new APIError(
        500,
        { error: { type: 'overloaded_error', message: 'x' } },
        'overloaded',
        new Headers(),
      )
      // SDK's APIError ctor sets .message from the body — verify our string match works
      expect(err.message).toContain('"type":"overloaded_error"')
      expect(is529Error(err)).toBe(true)
    })

    test('APIError 500 without overloaded body → false', () => {
      const err = new APIError(500, undefined, 'server error', new Headers())
      expect(is529Error(err)).toBe(false)
    })

    test('null/undefined → false (defensive)', () => {
      expect(is529Error(null)).toBe(false)
      expect(is529Error(undefined)).toBe(false)
    })
  })

  describe('getRetryDelay', () => {
    test('respects retry-after header (server hint wins over exponential)', () => {
      expect(getRetryDelay(1, '60')).toBe(60_000)
      expect(getRetryDelay(5, '120')).toBe(120_000)
    })

    test('ignores non-numeric retry-after (falls back to backoff)', () => {
      const delay = getRetryDelay(1, 'not-a-number')
      // Should fall to exponential path — at least BASE_DELAY_MS (no jitter floor)
      expect(delay).toBeGreaterThanOrEqual(500) // base delay ~500-1000ms
    })

    test('exponential backoff: attempt 1 < attempt 2 < attempt 3 (jitter aside)', () => {
      // Sample 100 times to defeat jitter. The median should monotonically
      // increase across attempts.
      const median = (arr: number[]) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)]
      const sample = (attempt: number) =>
        median(Array.from({ length: 100 }, () => getRetryDelay(attempt)))
      expect(sample(2)).toBeGreaterThan(sample(1))
      expect(sample(3)).toBeGreaterThan(sample(2))
    })

    test('caps at maxDelayMs (default 32000)', () => {
      // attempt 20 would yield 2^19 * baseDelay = millions of ms without cap
      expect(getRetryDelay(20)).toBeLessThanOrEqual(32_000 * 1.25 + 1) // +25% jitter ceiling
    })

    test('caller can override max delay (e.g., for /persistent retry mode)', () => {
      expect(getRetryDelay(20, undefined, 5000)).toBeLessThanOrEqual(5000 * 1.25 + 1)
    })
  })

  describe('parseMaxTokensContextOverflowError', () => {
    test('parses the exact server message format', () => {
      const err = new APIError(
        400,
        { error: { message: 'input length and `max_tokens` exceed context limit: 188059 + 20000 > 200000' } },
        'too big',
        new Headers(),
      )
      const parsed = parseMaxTokensContextOverflowError(err)
      expect(parsed).toEqual({
        inputTokens: 188059,
        maxTokens: 20000,
        contextLimit: 200000,
      })
    })

    test('non-400 → undefined (only this exact error class matters)', () => {
      const err = new APIError(429, undefined, 'rate limit', new Headers())
      expect(parseMaxTokensContextOverflowError(err)).toBeUndefined()
    })

    test('400 but different error message → undefined (don\'t misparse other 400s)', () => {
      const err = new APIError(400, undefined, 'invalid_request_error: bad something', new Headers())
      expect(parseMaxTokensContextOverflowError(err)).toBeUndefined()
    })
  })

  describe('error types', () => {
    test('CannotRetryError carries original error AND retry context', () => {
      const original = new Error('giving up')
      const ctx = { model: 'sonnet', thinkingConfig: { type: 'disabled' as const } }
      const wrapped = new CannotRetryError(original, ctx)
      expect(wrapped.originalError).toBe(original)
      expect(wrapped.retryContext).toBe(ctx)
      expect(wrapped.name).toBe('RetryError')
      // Stack preservation lets debuggers / logs trace back to the real origin
      expect(wrapped.stack).toBe(original.stack)
    })

    test('FallbackTriggeredError carries both model names', () => {
      const err = new FallbackTriggeredError('opus', 'sonnet')
      expect(err.originalModel).toBe('opus')
      expect(err.fallbackModel).toBe('sonnet')
      expect(err.message).toContain('opus -> sonnet')
    })
  })
})
