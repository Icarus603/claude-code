import { describe, expect, test } from 'bun:test'
import type { APIError } from '@anthropic-ai/sdk'
import {
  extractConnectionErrorDetails,
  formatAPIError,
  getSSLErrorHint,
  sanitizeAPIError,
} from '../errorUtils.js'

// Helper: build an Error with cause chain.
function err(message: string, code?: string, cause?: unknown): Error {
  const e = new Error(message)
  if (code !== undefined) (e as unknown as { code: string }).code = code
  if (cause !== undefined) (e as unknown as { cause: unknown }).cause = cause
  return e
}

describe('extractConnectionErrorDetails', () => {
  test('returns null for non-objects', () => {
    expect(extractConnectionErrorDetails(null)).toBeNull()
    expect(extractConnectionErrorDetails(undefined)).toBeNull()
    expect(extractConnectionErrorDetails(42)).toBeNull()
    expect(extractConnectionErrorDetails('string error')).toBeNull()
  })

  test('extracts code+message from a top-level Error with .code', () => {
    const e = err('connect ENOENT', 'ENOENT')
    expect(extractConnectionErrorDetails(e)).toEqual({
      code: 'ENOENT',
      message: 'connect ENOENT',
      isSSLError: false,
    })
  })

  test('marks SSL_ERROR_CODES set members as isSSLError=true', () => {
    const e = err('cert expired', 'CERT_HAS_EXPIRED')
    expect(extractConnectionErrorDetails(e)?.isSSLError).toBe(true)
  })

  test('marks non-SSL codes as isSSLError=false', () => {
    expect(
      extractConnectionErrorDetails(err('refused', 'ECONNREFUSED'))?.isSSLError,
    ).toBe(false)
  })

  test('walks cause chain to find code (depth 1)', () => {
    const inner = err('boom', 'EHOSTUNREACH')
    const outer = err('wrapped', undefined, inner)
    expect(extractConnectionErrorDetails(outer)).toEqual({
      code: 'EHOSTUNREACH',
      message: 'boom',
      isSSLError: false,
    })
  })

  test('walks cause chain depth-2 (SDK wraps cause within cause)', () => {
    const root = err('tls err', 'CERT_HAS_EXPIRED')
    const middle = err('mid', undefined, root)
    const top = err('top', undefined, middle)
    expect(extractConnectionErrorDetails(top)?.code).toBe('CERT_HAS_EXPIRED')
  })

  test('caps depth at 5 to prevent infinite-loop on cyclic causes', () => {
    // self-referencing cycle.
    const a = err('a', undefined, undefined)
    ;(a as unknown as { cause: unknown }).cause = a
    expect(extractConnectionErrorDetails(a)).toBeNull()
  })

  test('chain of 5 unrelated nodes (no code) → null (depth limit)', () => {
    let c: Error = err('leaf')
    for (let i = 0; i < 5; i++) c = err(`level-${i}`, undefined, c)
    expect(extractConnectionErrorDetails(c)).toBeNull()
  })

  test('non-string code is ignored', () => {
    const e = err('weird')
    ;(e as unknown as { code: number }).code = 42
    expect(extractConnectionErrorDetails(e)).toBeNull()
  })

  test('returns FIRST error with code (closest to root)', () => {
    // Walks from outermost down; returns at the FIRST node with a string
    // .code. So an outer ECONNREFUSED wraps an inner CERT_HAS_EXPIRED →
    // outer wins (since the walk hits it first). Document this.
    const inner = err('inner', 'CERT_HAS_EXPIRED')
    const outer = err('outer', 'ECONNREFUSED', inner)
    expect(extractConnectionErrorDetails(outer)?.code).toBe('ECONNREFUSED')
  })
})

describe('getSSLErrorHint', () => {
  test('returns null for non-error', () => {
    expect(getSSLErrorHint(null)).toBeNull()
    expect(getSSLErrorHint('plain string')).toBeNull()
  })

  test('returns null for non-SSL error code', () => {
    expect(getSSLErrorHint(err('not ssl', 'ECONNRESET'))).toBeNull()
  })

  test('returns hint for SSL error', () => {
    const hint = getSSLErrorHint(err('cert exp', 'CERT_HAS_EXPIRED'))
    expect(hint).toContain('SSL certificate error')
    expect(hint).toContain('CERT_HAS_EXPIRED')
    expect(hint).toContain('NODE_EXTRA_CA_CERTS')
    expect(hint).toContain('/doctor')
  })

  test('returns hint for self-signed cert (common Zscaler / corp proxy case)', () => {
    const hint = getSSLErrorHint(err('self', 'SELF_SIGNED_CERT_IN_CHAIN'))
    expect(hint).toContain('SELF_SIGNED_CERT_IN_CHAIN')
  })
})

describe('sanitizeAPIError — HTML stripping', () => {
  function apiErr(message: string, status?: number): APIError {
    // APIError has many fields; we only need .message and .status.
    return { message, status } as unknown as APIError
  }

  test('plain message passes through unchanged', () => {
    expect(sanitizeAPIError(apiErr('Bad Request'))).toBe('Bad Request')
  })

  test('empty message returns empty string', () => {
    expect(sanitizeAPIError(apiErr(''))).toBe('')
  })

  test('undefined message returns empty (decompiled-comment guard)', () => {
    expect(sanitizeAPIError(apiErr(undefined as unknown as string))).toBe('')
  })

  test('CloudFlare-style HTML with <title> → returns title text', () => {
    const html =
      '<!DOCTYPE html><html><head><title>522: Connection timed out</title></head></html>'
    expect(sanitizeAPIError(apiErr(html))).toBe('522: Connection timed out')
  })

  test('HTML without <title> → returns empty', () => {
    expect(sanitizeAPIError(apiErr('<!DOCTYPE html><html></html>'))).toBe('')
  })

  test('<html> without doctype also detected', () => {
    expect(
      sanitizeAPIError(apiErr('<html><head><title>Oops</title></head></html>')),
    ).toBe('Oops')
  })

  test('title with surrounding whitespace is trimmed', () => {
    expect(
      sanitizeAPIError(
        apiErr('<!DOCTYPE html><title>   Spaced Title   </title>'),
      ),
    ).toBe('Spaced Title')
  })
})

describe('formatAPIError', () => {
  function apiErr(opts: {
    message?: string
    cause?: unknown
    status?: number
    error?: unknown
  }): APIError {
    const e = new Error(opts.message ?? '')
    if (opts.cause !== undefined)
      (e as unknown as { cause: unknown }).cause = opts.cause
    if (opts.status !== undefined)
      (e as unknown as { status: number }).status = opts.status
    if (opts.error !== undefined)
      (e as unknown as { error: unknown }).error = opts.error
    return e as unknown as APIError
  }

  test('ETIMEDOUT in cause → fixed timeout message', () => {
    const error = apiErr({
      message: 'Connection error.',
      cause: err('timeout', 'ETIMEDOUT'),
    })
    expect(formatAPIError(error)).toBe(
      'Request timed out. Check your internet connection and proxy settings',
    )
  })

  test('CERT_HAS_EXPIRED → expired-cert message', () => {
    const error = apiErr({
      message: 'Connection error.',
      cause: err('expired', 'CERT_HAS_EXPIRED'),
    })
    expect(formatAPIError(error)).toBe(
      'Unable to connect to API: SSL certificate has expired',
    )
  })

  test('UNABLE_TO_VERIFY_LEAF_SIGNATURE → corp-proxy message', () => {
    const error = apiErr({
      cause: err('verify', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'),
    })
    expect(formatAPIError(error)).toContain(
      'SSL certificate verification failed',
    )
  })

  test('SELF_SIGNED_CERT_IN_CHAIN → self-signed message', () => {
    const error = apiErr({
      cause: err('self-signed', 'SELF_SIGNED_CERT_IN_CHAIN'),
    })
    expect(formatAPIError(error)).toContain('Self-signed certificate detected')
  })

  test('CERT_REVOKED → revoked message', () => {
    const error = apiErr({ cause: err('rev', 'CERT_REVOKED') })
    expect(formatAPIError(error)).toContain('SSL certificate has been revoked')
  })

  test('hostname mismatch → mismatch message', () => {
    const error = apiErr({ cause: err('hn', 'HOSTNAME_MISMATCH') })
    expect(formatAPIError(error)).toContain('SSL certificate hostname mismatch')
  })

  test('unknown SSL code → generic SSL error message', () => {
    const error = apiErr({ cause: err('weird', 'CERT_REJECTED') })
    expect(formatAPIError(error)).toBe(
      'Unable to connect to API: SSL error (CERT_REJECTED)',
    )
  })

  test('"Connection error." with non-SSL code → "Unable to connect (CODE)"', () => {
    const error = apiErr({
      message: 'Connection error.',
      cause: err('refused', 'ECONNREFUSED'),
    })
    expect(formatAPIError(error)).toBe(
      'Unable to connect to API (ECONNREFUSED)',
    )
  })

  test('"Connection error." with no cause → fallback message', () => {
    const error = apiErr({ message: 'Connection error.' })
    expect(formatAPIError(error)).toBe(
      'Unable to connect to API. Check your internet connection',
    )
  })

  test('CloudFlare HTML message → sanitized to title', () => {
    const error = apiErr({
      message: '<!DOCTYPE html><title>522: Origin Connection Time-out</title>',
    })
    expect(formatAPIError(error)).toBe('522: Origin Connection Time-out')
  })

  test('plain non-HTML message passes through', () => {
    const error = apiErr({ message: 'Rate limit exceeded' })
    expect(formatAPIError(error)).toBe('Rate limit exceeded')
  })

  test('missing message + status → "API error (status N)"', () => {
    const error = apiErr({ status: 500 })
    expect(formatAPIError(error)).toBe('API error (status 500)')
  })

  test('missing message + no status → "API error (status unknown)"', () => {
    const error = apiErr({})
    expect(formatAPIError(error)).toBe('API error (status unknown)')
  })

  test('Anthropic nested error shape (deserialized JSONL)', () => {
    // { error: { error: { message } } } — standard 1P API shape after
    // JSON round-tripping through session storage.
    const error = apiErr({
      error: { error: { message: 'rate_limit_exceeded' } },
    })
    expect(formatAPIError(error)).toBe('rate_limit_exceeded')
  })

  test('Bedrock nested error shape (one level)', () => {
    // { error: { message } } — Bedrock/proxy shape.
    const error = apiErr({ error: { message: 'throttled' } })
    expect(formatAPIError(error)).toBe('throttled')
  })

  test('nested HTML message gets sanitized', () => {
    const error = apiErr({
      error: {
        error: { message: '<!DOCTYPE html><title>503 Service Down</title>' },
      },
    })
    expect(formatAPIError(error)).toBe('503 Service Down')
  })

  test('deeper nesting wins over shallower', () => {
    // When BOTH .error.error.message AND .error.message exist, the
    // standard-Anthropic shape (deeper) wins. Document the precedence.
    const error = apiErr({
      error: {
        message: 'shallow-bedrock',
        error: { message: 'deep-anthropic' },
      },
    })
    expect(formatAPIError(error)).toBe('deep-anthropic')
  })

  test('nested with empty message after sanitization → falls through to next', () => {
    // Sanitized message is empty (HTML without title) → falls through.
    const error = apiErr({
      error: {
        error: { message: '<!DOCTYPE html><html></html>' }, // empty after sanitize
        message: 'fallback-bedrock',
      },
    })
    expect(formatAPIError(error)).toBe('fallback-bedrock')
  })

  test('no nested message + no top-level → status fallback', () => {
    const error = apiErr({
      error: { error: {} }, // nested but empty
      status: 502,
    })
    expect(formatAPIError(error)).toBe('API error (status 502)')
  })
})
