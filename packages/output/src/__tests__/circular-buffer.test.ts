import { describe, expect, test } from 'bun:test'
import { CircularBuffer } from '../buffers/circular-buffer.js'

describe('CircularBuffer.add + length + toArray', () => {
  test('starts empty', () => {
    const b = new CircularBuffer<number>(3)
    expect(b.length()).toBe(0)
    expect(b.toArray()).toEqual([])
  })
  test('grows up to capacity', () => {
    const b = new CircularBuffer<number>(3)
    b.add(1)
    b.add(2)
    expect(b.length()).toBe(2)
    expect(b.toArray()).toEqual([1, 2])
  })
  test('preserves insertion order until full', () => {
    const b = new CircularBuffer<number>(3)
    b.add(1)
    b.add(2)
    b.add(3)
    expect(b.toArray()).toEqual([1, 2, 3])
    expect(b.length()).toBe(3)
  })
  test('evicts oldest once over capacity', () => {
    const b = new CircularBuffer<number>(3)
    b.add(1)
    b.add(2)
    b.add(3)
    b.add(4) // evicts 1
    expect(b.toArray()).toEqual([2, 3, 4])
    expect(b.length()).toBe(3)
  })
  test('many adds keep length at capacity', () => {
    const b = new CircularBuffer<number>(3)
    for (let i = 1; i <= 100; i++) b.add(i)
    expect(b.length()).toBe(3)
    expect(b.toArray()).toEqual([98, 99, 100])
  })
})

describe('CircularBuffer.addAll', () => {
  test('adds all items in order', () => {
    const b = new CircularBuffer<string>(5)
    b.addAll(['a', 'b', 'c'])
    expect(b.toArray()).toEqual(['a', 'b', 'c'])
  })
  test('addAll respects capacity (evicts during loop)', () => {
    const b = new CircularBuffer<number>(3)
    b.addAll([1, 2, 3, 4, 5])
    expect(b.toArray()).toEqual([3, 4, 5])
  })
})

describe('CircularBuffer.getRecent', () => {
  test('returns last N when buffer has more', () => {
    const b = new CircularBuffer<number>(10)
    b.addAll([1, 2, 3, 4, 5])
    expect(b.getRecent(3)).toEqual([3, 4, 5])
  })
  test('returns all when N >= size', () => {
    const b = new CircularBuffer<number>(10)
    b.addAll([1, 2, 3])
    expect(b.getRecent(10)).toEqual([1, 2, 3])
  })
  test('returns empty when buffer is empty', () => {
    const b = new CircularBuffer<number>(5)
    expect(b.getRecent(3)).toEqual([])
  })
  test('handles N=0', () => {
    const b = new CircularBuffer<number>(5)
    b.addAll([1, 2, 3])
    expect(b.getRecent(0)).toEqual([])
  })
  test('post-eviction recent items are correct', () => {
    const b = new CircularBuffer<number>(3)
    b.addAll([1, 2, 3, 4, 5]) // buffer holds [3, 4, 5]
    expect(b.getRecent(2)).toEqual([4, 5])
    expect(b.getRecent(3)).toEqual([3, 4, 5])
  })
})

describe('CircularBuffer.clear', () => {
  test('empties the buffer', () => {
    const b = new CircularBuffer<number>(5)
    b.addAll([1, 2, 3])
    b.clear()
    expect(b.length()).toBe(0)
    expect(b.toArray()).toEqual([])
  })
  test('cleared buffer can be reused', () => {
    const b = new CircularBuffer<number>(3)
    b.addAll([1, 2, 3])
    b.clear()
    b.add(99)
    expect(b.toArray()).toEqual([99])
  })
})
