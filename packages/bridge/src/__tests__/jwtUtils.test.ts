import { describe, expect, test } from 'bun:test'
import { decodeJwtExpiry, decodeJwtPayload } from '../jwtUtils.js'

// Helper to build a fake JWT (header.payload.signature, base64url)
function makeJwt(payload: Record<string, unknown>, prefix = ''): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    .toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = 'sig'
  return prefix + `${header}.${body}.${sig}`
}

describe('decodeJwtPayload', () => {
  test('decodes valid 3-part JWT', () => {
    const jwt = makeJwt({ sub: 'user-123', exp: 1700000000 })
    expect(decodeJwtPayload(jwt)).toEqual({ sub: 'user-123', exp: 1700000000 })
  })
  test('strips sk-ant-si- session-ingress prefix', () => {
    const jwt = makeJwt({ sub: 'foo' }, 'sk-ant-si-')
    expect(decodeJwtPayload(jwt)).toEqual({ sub: 'foo' })
  })
  test('returns null for non-3-part input', () => {
    expect(decodeJwtPayload('foo.bar')).toBeNull()
    expect(decodeJwtPayload('plain')).toBeNull()
    expect(decodeJwtPayload('a.b.c.d')).toBeNull()
  })
  test('returns null when payload segment is empty', () => {
    expect(decodeJwtPayload('header..signature')).toBeNull()
  })
  test('returns null when payload is not valid JSON', () => {
    const garbage = `${Buffer.from('hdr').toString('base64url')}.${Buffer.from('not-json').toString('base64url')}.sig`
    expect(decodeJwtPayload(garbage)).toBeNull()
  })
  test('handles complex nested payloads', () => {
    const payload = { sub: 'x', nested: { a: [1, 2, 3] } }
    const jwt = makeJwt(payload)
    expect(decodeJwtPayload(jwt)).toEqual(payload)
  })
})

describe('decodeJwtExpiry', () => {
  test('extracts numeric exp claim', () => {
    const jwt = makeJwt({ exp: 1700000000 })
    expect(decodeJwtExpiry(jwt)).toBe(1700000000)
  })
  test('returns null when exp absent', () => {
    const jwt = makeJwt({ sub: 'x' })
    expect(decodeJwtExpiry(jwt)).toBeNull()
  })
  test('returns null when exp is non-numeric (string)', () => {
    const jwt = makeJwt({ exp: 'never' })
    expect(decodeJwtExpiry(jwt)).toBeNull()
  })
  test('returns null when token is malformed', () => {
    expect(decodeJwtExpiry('plain')).toBeNull()
    expect(decodeJwtExpiry('a.b.c.d')).toBeNull()
  })
  test('handles sk-ant-si- prefix in expiry path', () => {
    const jwt = makeJwt({ exp: 999 }, 'sk-ant-si-')
    expect(decodeJwtExpiry(jwt)).toBe(999)
  })
})
