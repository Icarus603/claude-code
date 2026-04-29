/**
 * Tests for array helper utilities.
 */
import { describe, expect, test } from 'bun:test'
import { count, intersperse, uniq } from '../utils/array.js'

describe('intersperse', () => {
  test('empty array → empty', () => {
    expect(intersperse([], () => '-')).toEqual([])
  })

  test('single element passes through', () => {
    expect(intersperse(['a'], () => '-')).toEqual(['a'])
  })

  test('two elements interleaved with one separator', () => {
    expect(intersperse(['a', 'b'], () => '-')).toEqual(['a', '-', 'b'])
  })

  test('three elements interleaved with two separators', () => {
    expect(intersperse(['a', 'b', 'c'], () => '-')).toEqual([
      'a',
      '-',
      'b',
      '-',
      'c',
    ])
  })

  test('separator function receives 1-based index', () => {
    // First separator (between [0] and [1]) gets index=1, etc.
    const seps: number[] = []
    intersperse(['a', 'b', 'c', 'd'], i => {
      seps.push(i)
      return '-'
    })
    expect(seps).toEqual([1, 2, 3])
  })

  test('separator can vary per index', () => {
    expect(
      intersperse(['a', 'b', 'c'], i => `[${i}]`),
    ).toEqual(['a', '[1]', 'b', '[2]', 'c'])
  })

  test('works with non-string types (numbers)', () => {
    expect(intersperse([1, 2, 3], () => 0)).toEqual([1, 0, 2, 0, 3])
  })
})

describe('count', () => {
  test('empty array → 0', () => {
    expect(count([], () => true)).toBe(0)
  })

  test('always-true predicate counts all', () => {
    expect(count([1, 2, 3, 4], () => true)).toBe(4)
  })

  test('always-false predicate counts none', () => {
    expect(count([1, 2, 3], () => false)).toBe(0)
  })

  test('counts even numbers', () => {
    expect(count([1, 2, 3, 4, 5, 6], n => n % 2 === 0)).toBe(3)
  })

  test('truthy/falsy non-boolean returns supported', () => {
    // The function uses +!!pred(x), so any truthy value counts as 1.
    expect(count([1, 2, 3], n => (n % 2 === 0 ? 'yes' : ''))).toBe(1)
    expect(count([1, 2, 3], n => (n > 1 ? n : null))).toBe(2)
  })

  test('undefined return → 0 contribution', () => {
    expect(count([1, 2, 3], () => undefined)).toBe(0)
  })
})

describe('uniq', () => {
  test('empty input → empty', () => {
    expect(uniq([])).toEqual([])
  })

  test('all unique passes through', () => {
    expect(uniq([1, 2, 3])).toEqual([1, 2, 3])
  })

  test('duplicates removed, first occurrence kept (Set semantics)', () => {
    expect(uniq([1, 2, 1, 3, 2])).toEqual([1, 2, 3])
  })

  test('preserves insertion order (Set order)', () => {
    expect(uniq(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c'])
  })

  test('reference equality for objects (Set default)', () => {
    const a = { id: 1 }
    const b = { id: 2 }
    // Same reference is dedup'd; structurally-equal but distinct objects are not.
    expect(uniq([a, b, a, { id: 1 }])).toEqual([a, b, { id: 1 }])
  })

  test('handles Set as input (already iterable)', () => {
    expect(uniq(new Set([1, 2, 3]))).toEqual([1, 2, 3])
  })

  test('handles generator as input', () => {
    function* gen() {
      yield 1
      yield 2
      yield 1
    }
    expect(uniq(gen())).toEqual([1, 2])
  })

  test('NaN considered same in Set (only one kept)', () => {
    // ECMAScript spec: NaN has Same-Value-Zero equality with itself in Set.
    expect(uniq([NaN, NaN, 1])).toHaveLength(2)
  })
})
