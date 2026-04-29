import { describe, expect, test } from 'bun:test'
import {
  clone,
  cloneDeep,
  jsonParse,
  jsonStringify,
} from '../slowOperations.js'

describe('jsonStringify (transparent wrapper)', () => {
  test('matches JSON.stringify for simple values', () => {
    expect(jsonStringify({ a: 1, b: [2, 3] })).toBe(
      JSON.stringify({ a: 1, b: [2, 3] }),
    )
  })
  test('passes replacer function through', () => {
    const replacer = (_key: string, value: unknown) =>
      typeof value === 'number' ? value * 2 : value
    expect(jsonStringify({ a: 1, b: 2 }, replacer)).toBe('{"a":2,"b":4}')
  })
  test('passes string replacer-array through', () => {
    expect(jsonStringify({ a: 1, b: 2, c: 3 }, ['a', 'c'])).toBe(
      '{"a":1,"c":3}',
    )
  })
  test('passes space through (pretty-print)', () => {
    expect(jsonStringify({ a: 1 }, null, 2)).toBe('{\n  "a": 1\n}')
  })
  test('handles primitives', () => {
    expect(jsonStringify(42)).toBe('42')
    expect(jsonStringify('hello')).toBe('"hello"')
    expect(jsonStringify(null)).toBe('null')
    expect(jsonStringify(true)).toBe('true')
  })
})

describe('jsonParse (transparent wrapper)', () => {
  test('matches JSON.parse for simple values', () => {
    expect(jsonParse('{"a":1,"b":[2,3]}')).toEqual({ a: 1, b: [2, 3] })
  })
  test('passes reviver through', () => {
    const reviver = (_key: string, value: unknown) =>
      typeof value === 'number' ? value * 10 : value
    expect(jsonParse('{"a":1,"b":2}', reviver)).toEqual({ a: 10, b: 20 })
  })
  test('handles primitives', () => {
    expect(jsonParse('42')).toBe(42)
    expect(jsonParse('"hello"')).toBe('hello')
    expect(jsonParse('null')).toBeNull()
    expect(jsonParse('true')).toBe(true)
  })
  test('throws on malformed JSON (passes through)', () => {
    expect(() => jsonParse('{not json}')).toThrow()
  })
})

describe('clone (structuredClone wrapper)', () => {
  test('produces a structurally equal copy', () => {
    const orig = { a: 1, nested: { b: [2, 3] } }
    const copy = clone(orig)
    expect(copy).toEqual(orig)
  })
  test('returns a different reference', () => {
    const orig = { a: 1 }
    expect(clone(orig)).not.toBe(orig)
  })
  test('deep-clones nested objects (mutating copy does not affect orig)', () => {
    const orig = { nested: { x: 1 } }
    const copy = clone(orig) as typeof orig
    copy.nested.x = 99
    expect(orig.nested.x).toBe(1)
  })
  test('clones arrays', () => {
    const orig = [1, 2, [3, 4]]
    const copy = clone(orig)
    expect(copy).toEqual(orig)
    expect(copy).not.toBe(orig)
  })
  test('clones Map and Set (structuredClone supports them)', () => {
    const m = new Map([['a', 1]])
    const copy = clone(m)
    expect(copy.get('a')).toBe(1)
    expect(copy).not.toBe(m)
  })
  test('handles primitives unchanged', () => {
    expect(clone(42)).toBe(42)
    expect(clone('hi')).toBe('hi')
    expect(clone(null)).toBeNull()
  })
})

describe('cloneDeep (lodash wrapper)', () => {
  test('deep-clones objects', () => {
    const orig = { a: { b: { c: 1 } } }
    const copy = cloneDeep(orig)
    expect(copy).toEqual(orig)
    expect(copy).not.toBe(orig)
    expect(copy.a).not.toBe(orig.a)
  })
  test('deep-clones arrays', () => {
    const orig = [[1], [2, 3]]
    const copy = cloneDeep(orig)
    copy[0]!.push(99)
    expect(orig[0]).toEqual([1])
    expect(copy[0]).toEqual([1, 99])
  })
  test('handles primitives', () => {
    expect(cloneDeep(42)).toBe(42)
    expect(cloneDeep('hi')).toBe('hi')
  })
})
