import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearToolSchemaCache,
  getToolSchemaCache,
} from '../toolSchemaCache.js'

afterEach(() => {
  clearToolSchemaCache()
})

describe('getToolSchemaCache', () => {
  test('returns the same Map reference across calls (module-level singleton)', () => {
    // Critical: the cache must be a shared singleton. If a refactor
    // accidentally creates a new Map per call, every getter sees an
    // empty cache and re-renders the ~11K-token tool block on every
    // request.
    const a = getToolSchemaCache()
    const b = getToolSchemaCache()
    expect(a).toBe(b)
  })

  test('returned Map can be mutated and survives subsequent get calls', () => {
    const cache = getToolSchemaCache()
    cache.set('Bash', { name: 'Bash', input_schema: { type: 'object' } } as never)
    expect(getToolSchemaCache().has('Bash')).toBe(true)
  })

  test('empty initially (after reset)', () => {
    expect(getToolSchemaCache().size).toBe(0)
  })
})

describe('clearToolSchemaCache', () => {
  test('removes all entries', () => {
    const cache = getToolSchemaCache()
    cache.set('a', { name: 'a' } as never)
    cache.set('b', { name: 'b' } as never)
    cache.set('c', { name: 'c' } as never)
    expect(cache.size).toBe(3)
    clearToolSchemaCache()
    expect(cache.size).toBe(0)
  })

  test('idempotent — clearing empty cache does not throw', () => {
    expect(() => clearToolSchemaCache()).not.toThrow()
    expect(getToolSchemaCache().size).toBe(0)
  })

  test('cache entries can be re-added after clear', () => {
    getToolSchemaCache().set('a', { name: 'a' } as never)
    clearToolSchemaCache()
    getToolSchemaCache().set('b', { name: 'b' } as never)
    expect(getToolSchemaCache().has('a')).toBe(false)
    expect(getToolSchemaCache().has('b')).toBe(true)
  })

  test('clear preserves the singleton Map reference', () => {
    // CRITICAL: clear must use Map.clear() (not reassign internal).
    // If the impl swaps the internal reference, callers that hold
    // a previously-returned reference would diverge from getter-now.
    const a = getToolSchemaCache()
    a.set('x', { name: 'x' } as never)
    clearToolSchemaCache()
    const b = getToolSchemaCache()
    expect(a).toBe(b) // SAME reference
    expect(a.size).toBe(0)
  })
})

describe('toolSchemaCache — survives across many cycles', () => {
  test('1000 set + clear cycles preserve invariants', () => {
    for (let i = 0; i < 1000; i++) {
      getToolSchemaCache().set(`tool-${i}`, { name: `tool-${i}` } as never)
    }
    expect(getToolSchemaCache().size).toBe(1000)
    clearToolSchemaCache()
    expect(getToolSchemaCache().size).toBe(0)
  })
})
