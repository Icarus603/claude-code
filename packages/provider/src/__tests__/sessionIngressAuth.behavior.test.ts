import { afterEach, describe, expect, test } from 'bun:test'

import {
  getSessionIngressAuthHeaders,
  getSessionIngressAuthToken,
  updateSessionIngressAuthToken,
} from '../sessionIngressAuth.ts'

/**
 * Pin session ingress auth token loading and header construction.
 * Used for the REPL Bridge / SSH-proxy authentication where the local
 * agent provides a session token that the remote side uses to
 * authenticate against the local OAuth proxy.
 */
describe('sessionIngressAuth (Bridge/SSH token loading)', () => {
  const savedEnv = process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN
  const savedOrg = process.env.CLAUDE_CODE_ORGANIZATION_UUID

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN
    } else {
      process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = savedEnv
    }
    if (savedOrg === undefined) {
      delete process.env.CLAUDE_CODE_ORGANIZATION_UUID
    } else {
      process.env.CLAUDE_CODE_ORGANIZATION_UUID = savedOrg
    }
  })

  test('CLAUDE_CODE_SESSION_ACCESS_TOKEN env var wins (priority 1)', () => {
    process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = 'test-token-from-env'
    expect(getSessionIngressAuthToken()).toBe('test-token-from-env')
  })

  test('updateSessionIngressAuthToken sets env var (in-process refresh)', () => {
    updateSessionIngressAuthToken('refreshed-token')
    expect(getSessionIngressAuthToken()).toBe('refreshed-token')
    expect(process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN).toBe('refreshed-token')
  })

  test('JWT token → Authorization: Bearer header', () => {
    process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx'
    const headers = getSessionIngressAuthHeaders()
    expect(headers).toEqual({
      Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx',
    })
  })

  test('Session key (sk-ant-sid prefix) → Cookie header (NOT Bearer)', () => {
    // Critical: session keys can't be sent as Bearer. They're cookies.
    process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = 'sk-ant-sid-abc12345'
    const headers = getSessionIngressAuthHeaders()
    expect(headers.Cookie).toBe('sessionKey=sk-ant-sid-abc12345')
    expect(headers.Authorization).toBeUndefined()
  })

  test('Session key WITH org UUID → adds X-Organization-Uuid (CCR multi-tenant)', () => {
    process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = 'sk-ant-sid-foo'
    process.env.CLAUDE_CODE_ORGANIZATION_UUID = 'org-uuid-bar'
    const headers = getSessionIngressAuthHeaders()
    expect(headers).toEqual({
      Cookie: 'sessionKey=sk-ant-sid-foo',
      'X-Organization-Uuid': 'org-uuid-bar',
    })
  })

  test('JWT token does NOT pick up X-Organization-Uuid (Bearer path is org-agnostic)', () => {
    // JWTs already embed the org context in their payload, so the
    // X-Organization-Uuid header would conflict. Pin its absence.
    process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.xxx'
    process.env.CLAUDE_CODE_ORGANIZATION_UUID = 'org-uuid-bar'
    const headers = getSessionIngressAuthHeaders()
    expect(headers['X-Organization-Uuid']).toBeUndefined()
    expect(headers.Authorization).toBe('Bearer eyJhbGciOiJIUzI1NiJ9.xxx')
  })

  test('no token → empty headers (no spurious "Bearer null" string)', () => {
    delete process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN
    expect(getSessionIngressAuthHeaders()).toEqual({})
  })
})
