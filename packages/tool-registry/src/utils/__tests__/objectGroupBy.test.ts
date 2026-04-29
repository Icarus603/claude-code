import { describe, expect, test } from 'bun:test'
import { objectGroupBy } from '../objectGroupBy.js'

describe('objectGroupBy', () => {
  test('groups items by key selector', () => {
    const items = [1, 2, 3, 4, 5]
    const result = objectGroupBy(items, n => (n % 2 === 0 ? 'even' : 'odd'))
    expect(result).toEqual({ odd: [1, 3, 5], even: [2, 4] })
  })

  test('preserves item order within each group', () => {
    const items = [
      { id: 1, type: 'a' },
      { id: 2, type: 'b' },
      { id: 3, type: 'a' },
      { id: 4, type: 'a' },
    ]
    const result = objectGroupBy(items, x => x.type)
    expect(result.a?.map(x => x.id)).toEqual([1, 3, 4])
    expect(result.b?.map(x => x.id)).toEqual([2])
  })

  test('keySelector receives index (0-based)', () => {
    const indices: number[] = []
    objectGroupBy(['a', 'b', 'c'], (_, i) => {
      indices.push(i)
      return 'k'
    })
    expect(indices).toEqual([0, 1, 2])
  })

  test('empty iterable returns empty object', () => {
    expect(objectGroupBy([], () => 'any')).toEqual({})
  })

  test('single-group scenario', () => {
    expect(objectGroupBy([1, 2, 3], () => 'all')).toEqual({ all: [1, 2, 3] })
  })

  test('result has null prototype (no inherited Object methods leak)', () => {
    // Contract: `Object.create(null)` — protects against prototype
    // pollution and accidental key collisions with 'toString',
    // 'hasOwnProperty', etc.
    const result = objectGroupBy([1, 2], () => 'toString')
    expect(Object.getPrototypeOf(result)).toBeNull()
  })

  test('numeric string keys work as PropertyKey', () => {
    const result = objectGroupBy(['x', 'y', 'z'], (_, i) => String(i))
    expect(result['0']).toEqual(['x'])
    expect(result['1']).toEqual(['y'])
    expect(result['2']).toEqual(['z'])
  })

  test('symbol keys work as PropertyKey', () => {
    const KEY_A = Symbol('a')
    const KEY_B = Symbol('b')
    const result = objectGroupBy(
      [1, 2, 3, 4],
      n => (n % 2 ? KEY_A : KEY_B),
    )
    expect(result[KEY_A]).toEqual([1, 3])
    expect(result[KEY_B]).toEqual([2, 4])
  })

  test('handles iterables (not just arrays)', () => {
    function* gen() {
      yield 1
      yield 2
      yield 3
    }
    const result = objectGroupBy(gen(), n => (n > 1 ? 'big' : 'small'))
    expect(result.small).toEqual([1])
    expect(result.big).toEqual([2, 3])
  })

  test('does NOT mutate input', () => {
    const items = [1, 2, 3]
    const before = [...items]
    objectGroupBy(items, () => 'k')
    expect(items).toEqual(before)
  })
})
