import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { logAuthEvent } from '../telemetry/authEvent.ts'
import { __resetOTelEventStateForTest } from '../telemetry/events.ts'
import {
  getEventLogger,
  setEventLogger,
} from '@claude-code/app-host/bootstrap/state.js'

/**
 * Pin port of ant v2.1.136 vBH (2642.js) — typed wrapper around the
 * `claude_code.auth` OTel structured event.
 *
 * ant shape:
 *   k5("auth", {
 *     action,
 *     success: String(success),
 *     auth_method,
 *     ...(error && { error_category, ...(status && { status_code }) }),
 *   })
 *
 * The error_category bucket comes from ant VV (0191.js):
 *   - { isAxiosError: true } + response.status 401|403  → 'auth'
 *   - code === 'ECONNABORTED'                          → 'timeout'
 *   - code === 'ECONNREFUSED' | 'ENOTFOUND'             → 'network'
 *   - other axios errors                                → 'http'
 *   - anything else                                     → 'other'
 */

type EmittedLog = {
  timestamp: Date
  observedTimestamp: Date
  body: string
  attributes: Record<string, unknown>
}

function makeFakeLogger(): {
  emitted: EmittedLog[]
  emit: (l: EmittedLog) => void
} {
  const emitted: EmittedLog[] = []
  return {
    emitted,
    emit(l) {
      emitted.push(l)
    },
  }
}

const originalLogger = getEventLogger()

beforeEach(() => {
  __resetOTelEventStateForTest()
})

afterEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  setEventLogger(originalLogger as any)
})

describe('logAuthEvent — happy path', () => {
  test('success=true login → body claude_code.auth + 3 mandatory fields', async () => {
    const fake = makeFakeLogger()
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    setEventLogger(fake as any)
    await logAuthEvent({ action: 'login', success: true, authMethod: 'oauth' })
    expect(fake.emitted.length).toBe(1)
    expect(fake.emitted[0]!.body).toBe('claude_code.auth')
    const attrs = fake.emitted[0]!.attributes
    expect(attrs['action']).toBe('login')
    expect(attrs['success']).toBe('true')
    expect(attrs['auth_method']).toBe('oauth')
    // No error → no error_category / status_code
    expect('error_category' in attrs).toBe(false)
    expect('status_code' in attrs).toBe(false)
  })

  test('success=false → "false" string (matches ant String(H.success))', async () => {
    const fake = makeFakeLogger()
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    setEventLogger(fake as any)
    await logAuthEvent({
      action: 'login',
      success: false,
      authMethod: 'oauth',
    })
    expect(fake.emitted[0]!.attributes['success']).toBe('false')
  })

  test('auth_method=api_key flows through', async () => {
    const fake = makeFakeLogger()
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    setEventLogger(fake as any)
    await logAuthEvent({
      action: 'login',
      success: true,
      authMethod: 'api_key',
    })
    expect(fake.emitted[0]!.attributes['auth_method']).toBe('api_key')
  })
})

describe('logAuthEvent — error classification (port of ant VV)', () => {
  test('non-axios Error → error_category="other", no status_code', async () => {
    const fake = makeFakeLogger()
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    setEventLogger(fake as any)
    await logAuthEvent({
      action: 'login',
      success: false,
      authMethod: 'oauth',
      error: new Error('boom'),
    })
    const attrs = fake.emitted[0]!.attributes
    expect(attrs['error_category']).toBe('other')
    expect('status_code' in attrs).toBe(false)
  })

  test('axios 401 → error_category="auth", status_code="401"', async () => {
    const fake = makeFakeLogger()
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    setEventLogger(fake as any)
    const err = { isAxiosError: true, response: { status: 401 } }
    await logAuthEvent({
      action: 'login',
      success: false,
      authMethod: 'oauth',
      error: err,
    })
    const attrs = fake.emitted[0]!.attributes
    expect(attrs['error_category']).toBe('auth')
    expect(attrs['status_code']).toBe('401')
  })

  test('axios 403 → error_category="auth", status_code="403"', async () => {
    const fake = makeFakeLogger()
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    setEventLogger(fake as any)
    await logAuthEvent({
      action: 'login',
      success: false,
      authMethod: 'oauth',
      error: { isAxiosError: true, response: { status: 403 } },
    })
    expect(fake.emitted[0]!.attributes['error_category']).toBe('auth')
    expect(fake.emitted[0]!.attributes['status_code']).toBe('403')
  })

  test('axios ECONNABORTED → error_category="timeout"', async () => {
    const fake = makeFakeLogger()
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    setEventLogger(fake as any)
    await logAuthEvent({
      action: 'login',
      success: false,
      authMethod: 'oauth',
      error: { isAxiosError: true, code: 'ECONNABORTED' },
    })
    expect(fake.emitted[0]!.attributes['error_category']).toBe('timeout')
  })

  test('axios ECONNREFUSED → error_category="network"', async () => {
    const fake = makeFakeLogger()
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    setEventLogger(fake as any)
    await logAuthEvent({
      action: 'login',
      success: false,
      authMethod: 'oauth',
      error: { isAxiosError: true, code: 'ECONNREFUSED' },
    })
    expect(fake.emitted[0]!.attributes['error_category']).toBe('network')
  })

  test('axios ENOTFOUND → error_category="network"', async () => {
    const fake = makeFakeLogger()
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    setEventLogger(fake as any)
    await logAuthEvent({
      action: 'login',
      success: false,
      authMethod: 'oauth',
      error: { isAxiosError: true, code: 'ENOTFOUND' },
    })
    expect(fake.emitted[0]!.attributes['error_category']).toBe('network')
  })

  test('axios 500 → error_category="http", status_code="500"', async () => {
    const fake = makeFakeLogger()
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    setEventLogger(fake as any)
    await logAuthEvent({
      action: 'login',
      success: false,
      authMethod: 'oauth',
      error: { isAxiosError: true, response: { status: 500 } },
    })
    expect(fake.emitted[0]!.attributes['error_category']).toBe('http')
    expect(fake.emitted[0]!.attributes['status_code']).toBe('500')
  })

  test('isAxiosError flag false → "other" (not isAxiosError-shaped)', async () => {
    const fake = makeFakeLogger()
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    setEventLogger(fake as any)
    await logAuthEvent({
      action: 'login',
      success: false,
      authMethod: 'oauth',
      error: { isAxiosError: false, response: { status: 401 } },
    })
    expect(fake.emitted[0]!.attributes['error_category']).toBe('other')
  })
})
