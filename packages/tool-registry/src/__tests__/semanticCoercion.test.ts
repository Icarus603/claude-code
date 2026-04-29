/**
 * Tests for semantic-coercion zod utilities + objectGroupBy.
 *
 * semanticBoolean / semanticNumber tolerate the model's occasional
 * habit of quoting boolean/number values in tool inputs ("true"
 * instead of true). z.coerce.* would be the wrong fix because it
 * uses lossy JS truthiness ("false" → true is a real bug).
 *
 * objectGroupBy mirrors the TC39 Object.groupBy proposal — used for
 * transcript-search heuristics, plugin grouping, etc.
 */
import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { objectGroupBy } from '../utils/objectGroupBy.js'
import { semanticBoolean } from '../utils/semanticBoolean.js'
import { semanticNumber } from '../utils/semanticNumber.js'

describe('semanticBoolean — tolerant boolean parsing', () => {
  test('plain true / false pass through', () => {
    const schema = semanticBoolean()
    expect(schema.parse(true)).toBe(true)
    expect(schema.parse(false)).toBe(false)
  })

  test('"true" string → true', () => {
    expect(semanticBoolean().parse('true')).toBe(true)
  })

  test('"false" string → false (CRITICAL: not truthiness)', () => {
    // z.coerce.boolean() would convert "false" → true via Boolean("false").
    // The semanticBoolean preprocessor maps "false" string to false bool.
    expect(semanticBoolean().parse('false')).toBe(false)
  })

  test('arbitrary truthy string like "yes" rejected', () => {
    expect(() => semanticBoolean().parse('yes')).toThrow()
  })

  test('arbitrary number rejected', () => {
    expect(() => semanticBoolean().parse(1)).toThrow()
  })

  test('null rejected', () => {
    expect(() => semanticBoolean().parse(null)).toThrow()
  })

  test('case-sensitive: "True" rejected', () => {
    // Documented: only lowercase "true"/"false" coerced.
    expect(() => semanticBoolean().parse('True')).toThrow()
  })

  test('with .optional() inner, undefined passes', () => {
    expect(semanticBoolean(z.boolean().optional()).parse(undefined)).toBeUndefined()
  })

  test('with .default(false), missing input returns default', () => {
    expect(semanticBoolean(z.boolean().default(false)).parse(undefined)).toBe(false)
  })
})

describe('semanticNumber — tolerant number parsing', () => {
  test('plain numbers pass through', () => {
    expect(semanticNumber().parse(42)).toBe(42)
    expect(semanticNumber().parse(-7)).toBe(-7)
    expect(semanticNumber().parse(3.14)).toBe(3.14)
  })

  test('"42" string → 42', () => {
    expect(semanticNumber().parse('42')).toBe(42)
  })

  test('"-5" string → -5', () => {
    expect(semanticNumber().parse('-5')).toBe(-5)
  })

  test('"3.14" string → 3.14', () => {
    expect(semanticNumber().parse('3.14')).toBe(3.14)
  })

  test('empty string rejected (not a valid number literal)', () => {
    // z.coerce.number() would convert '' → 0. semanticNumber rejects.
    expect(() => semanticNumber().parse('')).toThrow()
  })

  test('null rejected', () => {
    expect(() => semanticNumber().parse(null)).toThrow()
  })

  test('"abc" rejected', () => {
    expect(() => semanticNumber().parse('abc')).toThrow()
  })

  test('"1e5" scientific NOT coerced (regex is strict decimal)', () => {
    // Documented regex: /^-?\d+(\.\d+)?$/ — no exponent support.
    expect(() => semanticNumber().parse('1e5')).toThrow()
  })

  test('"1." (trailing dot, no fractional) rejected', () => {
    expect(() => semanticNumber().parse('1.')).toThrow()
  })

  test('".5" (leading dot, no integer) rejected', () => {
    expect(() => semanticNumber().parse('.5')).toThrow()
  })

  test('whitespace around number rejected', () => {
    expect(() => semanticNumber().parse(' 42')).toThrow()
    expect(() => semanticNumber().parse('42 ')).toThrow()
  })

  test('Infinity-string rejected', () => {
    expect(() => semanticNumber().parse('Infinity')).toThrow()
  })

  test('with .optional() inner, undefined passes', () => {
    expect(semanticNumber(z.number().optional()).parse(undefined)).toBeUndefined()
  })

  test('with .default(0), undefined → 0', () => {
    expect(semanticNumber(z.number().default(0)).parse(undefined)).toBe(0)
  })
})

describe('objectGroupBy', () => {
  test('groups items by key selector', () => {
    const result = objectGroupBy([1, 2, 3, 4, 5], n => (n % 2 === 0 ? 'even' : 'odd'))
    expect(result).toEqual({ even: [2, 4], odd: [1, 3, 5] })
  })

  test('empty iterable → empty object', () => {
    expect(objectGroupBy([], () => 'k')).toEqual({})
  })

  test('all-same key produces single group', () => {
    expect(objectGroupBy([1, 2, 3], () => 'all')).toEqual({ all: [1, 2, 3] })
  })

  test('preserves insertion order within group', () => {
    const result = objectGroupBy(['a', 'b', 'c', 'd'], item =>
      item < 'c' ? 'first' : 'second',
    )
    expect(result.first).toEqual(['a', 'b'])
    expect(result.second).toEqual(['c', 'd'])
  })

  test('keySelector receives index', () => {
    const result = objectGroupBy(
      ['x', 'y', 'z'],
      (_, index) => (index < 2 ? 'lo' : 'hi'),
    )
    expect(result).toEqual({ lo: ['x', 'y'], hi: ['z'] })
  })

  test('result has null prototype (no inherited methods)', () => {
    // Documented via Object.create(null). This means `result.toString`
    // would NOT throw "is not a function" — it would be undefined.
    // The test locks the documented null-prototype behavior.
    const result = objectGroupBy([1], () => 'k')
    expect(Object.getPrototypeOf(result)).toBeNull()
  })

  test('symbol keys work', () => {
    const sym = Symbol('group')
    const result = objectGroupBy([1, 2], () => sym)
    expect((result as Record<symbol, unknown[]>)[sym]).toEqual([1, 2])
  })

  test('numeric keys work', () => {
    const result = objectGroupBy(['a', 'b', 'c'], (_, i) => i % 2)
    expect(result).toEqual({ 0: ['a', 'c'], 1: ['b'] })
  })

  test('Set as iterable input works', () => {
    const result = objectGroupBy(new Set([1, 2, 3]), n => 'all')
    expect(result.all).toHaveLength(3)
  })

  test('generator as iterable input works', () => {
    function* gen() {
      yield 1
      yield 2
      yield 3
    }
    const result = objectGroupBy(gen(), n => (n > 1 ? 'big' : 'small'))
    expect(result).toEqual({ small: [1], big: [2, 3] })
  })
})
