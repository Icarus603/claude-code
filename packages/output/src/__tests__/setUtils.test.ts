import { describe, expect, test } from 'bun:test'
import {
  difference,
  every,
  intersects,
  union,
} from '../setUtils.js'

describe('difference', () => {
  test('a \\ b — items in a but not b', () => {
    const result = difference(new Set([1, 2, 3]), new Set([2, 3, 4]))
    expect([...result]).toEqual([1])
  })
  test('a \\ empty == a', () => {
    const result = difference(new Set([1, 2]), new Set())
    expect([...result].sort()).toEqual([1, 2])
  })
  test('empty \\ b == empty', () => {
    expect(difference(new Set<number>(), new Set([1])).size).toBe(0)
  })
  test('disjoint sets — a \\ b == a', () => {
    const a = new Set([1, 2])
    const b = new Set([3, 4])
    expect([...difference(a, b)].sort()).toEqual([1, 2])
  })
  test('does not mutate either input', () => {
    const a = new Set([1, 2])
    const b = new Set([2, 3])
    difference(a, b)
    expect([...a].sort()).toEqual([1, 2])
    expect([...b].sort()).toEqual([2, 3])
  })
})

describe('intersects', () => {
  test('returns true if any element shared', () => {
    expect(intersects(new Set([1, 2, 3]), new Set([3, 4, 5]))).toBe(true)
  })
  test('returns false on disjoint sets', () => {
    expect(intersects(new Set([1, 2]), new Set([3, 4]))).toBe(false)
  })
  test('returns false when either set is empty (perf optimization)', () => {
    expect(intersects(new Set(), new Set([1]))).toBe(false)
    expect(intersects(new Set([1]), new Set())).toBe(false)
    expect(intersects(new Set(), new Set())).toBe(false)
  })
  test('does not iterate further than the first match (early exit)', () => {
    expect(intersects(new Set([1, 2, 3, 4, 5]), new Set([1]))).toBe(true)
  })
})

describe('every', () => {
  test('a ⊆ b returns true', () => {
    expect(every(new Set([1, 2]), new Set([1, 2, 3]))).toBe(true)
  })
  test('a == b returns true', () => {
    expect(every(new Set([1, 2]), new Set([1, 2]))).toBe(true)
  })
  test('disjoint returns false', () => {
    expect(every(new Set([1]), new Set([2]))).toBe(false)
  })
  test('empty a always returns true (vacuously)', () => {
    expect(every(new Set(), new Set([1, 2]))).toBe(true)
    expect(every(new Set(), new Set())).toBe(true)
  })
  test('a is partial overlap returns false', () => {
    expect(every(new Set([1, 2, 3]), new Set([1, 2]))).toBe(false)
  })
})

describe('union', () => {
  test('combines disjoint sets', () => {
    const result = union(new Set([1, 2]), new Set([3, 4]))
    expect([...result].sort()).toEqual([1, 2, 3, 4])
  })
  test('deduplicates overlap', () => {
    const result = union(new Set([1, 2, 3]), new Set([2, 3, 4]))
    expect([...result].sort()).toEqual([1, 2, 3, 4])
  })
  test('empty + empty == empty', () => {
    expect(union(new Set<number>(), new Set<number>()).size).toBe(0)
  })
  test('empty + b == b (copy)', () => {
    const result = union(new Set<number>(), new Set([1, 2]))
    expect([...result].sort()).toEqual([1, 2])
  })
  test('does not mutate either input', () => {
    const a = new Set([1])
    const b = new Set([2])
    union(a, b)
    expect([...a]).toEqual([1])
    expect([...b]).toEqual([2])
  })
})
