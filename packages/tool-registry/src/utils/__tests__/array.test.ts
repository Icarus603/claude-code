import { describe, expect, test } from 'bun:test'
import { count, intersperse, uniq } from '../array.js'

describe('intersperse', () => {
  test('inserts separator between elements', () => {
    expect(intersperse([1, 2, 3], () => 0)).toEqual([1, 0, 2, 0, 3])
  })

  test('separator function receives the running index (1-based, position-of-separator)', () => {
    const separators: number[] = []
    intersperse(['a', 'b', 'c'], i => {
      separators.push(i)
      return '-'
    })
    expect(separators).toEqual([1, 2])
  })

  test('empty array returns empty', () => {
    expect(intersperse([], () => 0)).toEqual([])
  })

  test('single element returns itself (no separators)', () => {
    expect(intersperse([42], () => 0)).toEqual([42])
  })

  test('preserves type of array elements', () => {
    expect(intersperse(['a', 'b'], () => '|')).toEqual(['a', '|', 'b'])
  })
})

describe('count', () => {
  test('counts elements where predicate returns truthy', () => {
    expect(count([1, 2, 3, 4, 5], n => n > 2)).toBe(3)
  })

  test('returns 0 when no element matches', () => {
    expect(count([1, 2, 3], () => false)).toBe(0)
  })

  test('returns array length when all match', () => {
    expect(count([1, 2, 3], () => true)).toBe(3)
  })

  test('truthy non-boolean values count as match', () => {
    // Contract: `+!!pred(x)` coerces to 0/1. So returning {} or 'x'
    // (truthy non-booleans) counts the element. Catches the silent-bug
    // shape where someone changes to `pred(x) === true` (strict).
    expect(count([1, 2, 3], () => 'truthy' as unknown as boolean)).toBe(3)
  })

  test('falsy non-false values do NOT count', () => {
    expect(count([1, 2, 3], () => 0 as unknown as boolean)).toBe(0)
    expect(count([1, 2, 3], () => '' as unknown as boolean)).toBe(0)
    expect(count([1, 2, 3], () => null as unknown as boolean)).toBe(0)
    expect(count([1, 2, 3], () => undefined as unknown as boolean)).toBe(0)
  })

  test('empty array returns 0', () => {
    expect(count([], () => true)).toBe(0)
  })

  test('handles readonly arrays (signature accepts ReadonlyArray)', () => {
    const readonly: readonly number[] = [1, 2, 3]
    expect(count(readonly, n => n > 1)).toBe(2)
  })
})

describe('uniq', () => {
  test('removes duplicate values from array', () => {
    expect(uniq([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3])
  })

  test('preserves first-occurrence order (Set insertion order)', () => {
    expect(uniq([3, 1, 2, 1, 3])).toEqual([3, 1, 2])
  })

  test('handles iterables (not just arrays)', () => {
    function* gen() {
      yield 'a'
      yield 'b'
      yield 'a'
    }
    expect(uniq(gen())).toEqual(['a', 'b'])
  })

  test('empty input returns empty', () => {
    expect(uniq([])).toEqual([])
  })

  test('strings deduped by value equality', () => {
    expect(uniq(['a', 'b', 'a'])).toEqual(['a', 'b'])
  })

  test('object references — uses identity (NOT structural)', () => {
    // Critical contract: Set uses === for reference types. Two
    // structurally-identical objects are considered different.
    const a = { x: 1 }
    const b = { x: 1 }
    expect(uniq([a, b, a])).toEqual([a, b])
  })

  test('NaN deduped (Set treats NaN as equal to itself, unlike ===)', () => {
    // ES2015 Set spec uses SameValueZero, which treats NaN === NaN as
    // true. This is non-obvious and worth locking in.
    expect(uniq([NaN, NaN])).toEqual([NaN])
  })
})
