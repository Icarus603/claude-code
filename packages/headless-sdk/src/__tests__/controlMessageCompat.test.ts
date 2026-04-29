import { describe, expect, test } from 'bun:test'
import { normalizeControlMessageKeys } from '../controlMessageCompat.js'

describe('normalizeControlMessageKeys — non-object inputs', () => {
  test('null passes through unchanged', () => {
    expect(normalizeControlMessageKeys(null)).toBe(null)
  })
  test('undefined passes through unchanged', () => {
    expect(normalizeControlMessageKeys(undefined)).toBe(undefined)
  })
  test('numbers pass through unchanged', () => {
    expect(normalizeControlMessageKeys(42)).toBe(42)
  })
  test('strings pass through unchanged', () => {
    expect(normalizeControlMessageKeys('hello')).toBe('hello')
  })
  test('booleans pass through unchanged', () => {
    expect(normalizeControlMessageKeys(true)).toBe(true)
  })
})

describe('normalizeControlMessageKeys — top-level requestId', () => {
  test('renames camelCase requestId → snake_case request_id', () => {
    const input = { requestId: 'abc123' }
    normalizeControlMessageKeys(input)
    expect(input).toEqual({ request_id: 'abc123' })
  })

  test('mutates in place (returns same reference)', () => {
    // Contract: function mutates rather than clone — declared in JSDoc.
    // Callers may rely on mutation semantics for performance.
    const input = { requestId: 'x' }
    const result = normalizeControlMessageKeys(input)
    expect(result).toBe(input)
  })

  test('does NOT touch existing request_id when both keys present', () => {
    // Contract: snake_case wins. The camelCase key is dropped, but
    // the existing snake_case value is preserved as-is.
    const input = { request_id: 'snake-wins', requestId: 'camel-loses' }
    normalizeControlMessageKeys(input)
    expect(input).toEqual({ request_id: 'snake-wins', requestId: 'camel-loses' })
  })

  test('only renames when request_id is absent', () => {
    const input = { request_id: 'preserve-me' }
    normalizeControlMessageKeys(input)
    expect(input).toEqual({ request_id: 'preserve-me' })
  })

  test('does nothing for an empty object', () => {
    const input = {}
    normalizeControlMessageKeys(input)
    expect(input).toEqual({})
  })

  test('preserves other keys', () => {
    const input = { requestId: 'r1', method: 'subscribe', params: { a: 1 } }
    normalizeControlMessageKeys(input)
    expect(input).toEqual({
      request_id: 'r1',
      method: 'subscribe',
      params: { a: 1 },
    })
  })
})

describe('normalizeControlMessageKeys — nested response.requestId', () => {
  test('renames response.requestId → response.request_id', () => {
    const input = { type: 'control_response', response: { requestId: 'nested-abc' } }
    normalizeControlMessageKeys(input)
    expect(input).toEqual({
      type: 'control_response',
      response: { request_id: 'nested-abc' },
    })
  })

  test('preserves other response fields', () => {
    const input = {
      response: { requestId: 'r1', subtype: 'success', data: { x: 42 } },
    }
    normalizeControlMessageKeys(input)
    expect(input).toEqual({
      response: { request_id: 'r1', subtype: 'success', data: { x: 42 } },
    })
  })

  test('handles BOTH top-level and nested rename in a single call', () => {
    const input = {
      requestId: 'outer',
      response: { requestId: 'inner' },
    }
    normalizeControlMessageKeys(input)
    expect(input).toEqual({
      request_id: 'outer',
      response: { request_id: 'inner' },
    })
  })

  test('snake_case in nested response wins over camelCase', () => {
    const input = {
      response: { request_id: 'snake', requestId: 'camel' },
    }
    normalizeControlMessageKeys(input)
    expect(input).toEqual({
      response: { request_id: 'snake', requestId: 'camel' },
    })
  })

  test('null response is left alone', () => {
    const input = { response: null }
    normalizeControlMessageKeys(input)
    expect(input).toEqual({ response: null })
  })

  test('non-object response (string) is left alone', () => {
    const input = { response: 'literal-string' }
    normalizeControlMessageKeys(input)
    expect(input).toEqual({ response: 'literal-string' })
  })

  test('does not recurse into deeply-nested objects (only one level)', () => {
    // Contract: only top-level + response.X are normalized. A
    // hypothetical response.payload.requestId is NOT touched. This
    // documents the depth-limit contract.
    const input = {
      response: {
        payload: { requestId: 'deeply-nested' },
      },
    }
    normalizeControlMessageKeys(input)
    expect(input).toEqual({
      response: { payload: { requestId: 'deeply-nested' } },
    })
  })
})

describe('normalizeControlMessageKeys — return value', () => {
  test('returns the same object reference on success', () => {
    const input = { requestId: 'x' }
    expect(normalizeControlMessageKeys(input)).toBe(input)
  })
  test('returns null when given null (no clone)', () => {
    expect(normalizeControlMessageKeys(null)).toBe(null)
  })
})
