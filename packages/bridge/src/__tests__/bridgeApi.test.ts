import { describe, expect, test } from 'bun:test'
import { BridgeFatalError, validateBridgeId } from '../bridgeApi.js'

describe('validateBridgeId — accepts safe ids', () => {
  test('alphanumeric', () => {
    expect(validateBridgeId('abc123', 'sessionId')).toBe('abc123')
  })
  test('underscore', () => {
    expect(validateBridgeId('cse_abc_123', 'sessionId')).toBe('cse_abc_123')
  })
  test('dash', () => {
    expect(validateBridgeId('my-session-1', 'sessionId')).toBe('my-session-1')
  })
  test('mixed safe chars', () => {
    expect(validateBridgeId('session_abc-123_X', 'sessionId')).toBe(
      'session_abc-123_X',
    )
  })
})

describe('validateBridgeId — rejects unsafe ids', () => {
  test('throws on empty string', () => {
    expect(() => validateBridgeId('', 'sessionId')).toThrow(
      /Invalid sessionId/,
    )
  })
  test('throws on path traversal (..)', () => {
    expect(() => validateBridgeId('../admin', 'sessionId')).toThrow(
      /unsafe characters/,
    )
  })
  test('throws on slash', () => {
    expect(() => validateBridgeId('foo/bar', 'sessionId')).toThrow()
  })
  test('throws on dot', () => {
    expect(() => validateBridgeId('foo.bar', 'sessionId')).toThrow()
  })
  test('throws on whitespace', () => {
    expect(() => validateBridgeId('foo bar', 'sessionId')).toThrow()
    expect(() => validateBridgeId('foo\tbar', 'sessionId')).toThrow()
  })
  test('throws on unicode', () => {
    expect(() => validateBridgeId('caf\u00e9', 'sessionId')).toThrow()
  })
  test('throws on URL-encoded chars', () => {
    expect(() => validateBridgeId('foo%2Fbar', 'sessionId')).toThrow()
  })
  test('error message includes label', () => {
    expect(() => validateBridgeId('!', 'targetId')).toThrow(/targetId/)
  })
})

describe('BridgeFatalError', () => {
  test('stores status + errorType + message', () => {
    const e = new BridgeFatalError('boom', 401, 'unauthorized')
    expect(e.status).toBe(401)
    expect(e.errorType).toBe('unauthorized')
    expect(e.message).toBe('boom')
    expect(e.name).toBe('BridgeFatalError')
  })
  test('errorType optional', () => {
    const e = new BridgeFatalError('plain', 500)
    expect(e.errorType).toBeUndefined()
  })
  test('is an Error subclass', () => {
    const e = new BridgeFatalError('x', 400)
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(BridgeFatalError)
  })
})
