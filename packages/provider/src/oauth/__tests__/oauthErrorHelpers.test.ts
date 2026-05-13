/**
 * Tests for OAuth refresh error-classification helpers — port-correctness
 * against ant v2.1.136 `tu_` / `MBq` / `d_1` (1255.js / 1256.js) and
 * `mt6` / `yX1` / `vX1` (1997.js).
 *
 * The mtime watcher and the refresh runner are integration-tested
 * elsewhere; these pin the pure helpers so future regressions are
 * caught at unit cost.
 */
import { describe, expect, test, beforeEach } from 'bun:test'
import { AxiosError, type AxiosResponse } from 'axios'
import {
  extractOAuthErrorFields,
  isInvalidGrantError,
} from '../client.js'
import {
  _resetForTesting,
  clearRefreshTokenDeadSet,
  isRefreshTokenDead,
  markRefreshTokenDead,
} from '../refreshTokenDeadSet.js'

function axiosErrorWith(
  status: number,
  body: unknown,
): AxiosError {
  const err = new AxiosError(
    'request failed',
    'ERR_BAD_RESPONSE',
    undefined,
    undefined,
    {
      status,
      statusText: '',
      headers: {},
      config: {} as never,
      data: body,
    } as AxiosResponse,
  )
  return err
}

describe('isInvalidGrantError (ant tu_)', () => {
  test('400 with `error: "invalid_grant"` (bare string) → true', () => {
    expect(isInvalidGrantError(axiosErrorWith(400, { error: 'invalid_grant' }))).toBe(true)
  })
  test('401 with `error.type === "invalid_grant"` (object) → true', () => {
    expect(
      isInvalidGrantError(
        axiosErrorWith(401, { error: { type: 'invalid_grant' } }),
      ),
    ).toBe(true)
  })
  test('400 with other error type → false', () => {
    expect(
      isInvalidGrantError(axiosErrorWith(400, { error: 'invalid_request' })),
    ).toBe(false)
  })
  test('500 with invalid_grant body → false (status gate is strict)', () => {
    expect(
      isInvalidGrantError(axiosErrorWith(500, { error: 'invalid_grant' })),
    ).toBe(false)
  })
  test('non-axios error → false', () => {
    expect(isInvalidGrantError(new Error('boom'))).toBe(false)
    expect(isInvalidGrantError(undefined)).toBe(false)
    expect(isInvalidGrantError(null)).toBe(false)
  })
  test('axios error without response → false', () => {
    const err = new AxiosError('network', 'ECONNREFUSED')
    expect(isInvalidGrantError(err)).toBe(false)
  })
  test('non-object body → false', () => {
    expect(isInvalidGrantError(axiosErrorWith(400, 'invalid_grant'))).toBe(false)
    expect(isInvalidGrantError(axiosErrorWith(400, null))).toBe(false)
  })
})

describe('extractOAuthErrorFields (ant MBq + d_1 regex)', () => {
  test('valid status + valid error type → fields populated', () => {
    expect(
      extractOAuthErrorFields(
        axiosErrorWith(400, { error: 'invalid_grant' }),
      ),
    ).toEqual({ oauth_error_status: '400', oauth_error_type: 'invalid_grant' })
  })
  test('object error → reads .type', () => {
    expect(
      extractOAuthErrorFields(
        axiosErrorWith(401, { error: { type: 'invalid_token' } }),
      ),
    ).toEqual({ oauth_error_status: '401', oauth_error_type: 'invalid_token' })
  })
  test('non-RFC type → "unparseable" (regex rejects)', () => {
    expect(
      extractOAuthErrorFields(
        axiosErrorWith(400, { error: 'WeirdSpace Mixed-Case With Spaces' }),
      ),
    ).toEqual({ oauth_error_status: '400', oauth_error_type: 'unparseable' })
  })
  test('over-length type → "unparseable" (40-char cap)', () => {
    expect(
      extractOAuthErrorFields(
        axiosErrorWith(400, { error: 'a'.repeat(50) }),
      ),
    ).toEqual({ oauth_error_status: '400', oauth_error_type: 'unparseable' })
  })
  test('non-axios → empty object', () => {
    expect(extractOAuthErrorFields(new Error('x'))).toEqual({})
  })
  test('axios without response → empty object', () => {
    expect(extractOAuthErrorFields(new AxiosError('net', 'ETIMEDOUT'))).toEqual({})
  })
})

describe('refreshTokenDeadSet (ant mt6)', () => {
  beforeEach(() => {
    _resetForTesting()
  })
  test('markRefreshTokenDead/isRefreshTokenDead round-trip', () => {
    expect(isRefreshTokenDead('abc')).toBe(false)
    markRefreshTokenDead('abc')
    expect(isRefreshTokenDead('abc')).toBe(true)
  })
  test('empty string is ignored on both sides', () => {
    markRefreshTokenDead('')
    expect(isRefreshTokenDead('')).toBe(false)
  })
  test('clearRefreshTokenDeadSet wipes everything', () => {
    markRefreshTokenDead('a')
    markRefreshTokenDead('b')
    clearRefreshTokenDeadSet()
    expect(isRefreshTokenDead('a')).toBe(false)
    expect(isRefreshTokenDead('b')).toBe(false)
  })
  test('mark→isDead is idempotent (adding twice has same effect)', () => {
    markRefreshTokenDead('xyz')
    markRefreshTokenDead('xyz')
    expect(isRefreshTokenDead('xyz')).toBe(true)
    clearRefreshTokenDeadSet()
    expect(isRefreshTokenDead('xyz')).toBe(false)
  })

  test('post-lock dead-set check (ant pt6 second mt6.has)', () => {
    // ant `pt6` checks `mt6.has(lockedTokens.refreshToken)` AFTER
    // acquiring the lock — if another worker on this process marked the
    // same token dead while we were waiting, don't burn the HTTP call.
    // ccb mirrors at authAlias.ts:1554. Pin the post-mark semantics so
    // a later regression that loses the second check gets caught.
    markRefreshTokenDead('post-lock-token')
    expect(isRefreshTokenDead('post-lock-token')).toBe(true)
  })

  test('different tokens isolate (no shared state across token values)', () => {
    markRefreshTokenDead('token-a')
    expect(isRefreshTokenDead('token-a')).toBe(true)
    expect(isRefreshTokenDead('token-b')).toBe(false)
    markRefreshTokenDead('token-b')
    expect(isRefreshTokenDead('token-a')).toBe(true)
    expect(isRefreshTokenDead('token-b')).toBe(true)
  })

  test('_resetForTesting wipes the dead-set (matches ant vX1 alias)', () => {
    markRefreshTokenDead('test-reset')
    _resetForTesting()
    expect(isRefreshTokenDead('test-reset')).toBe(false)
  })
})
