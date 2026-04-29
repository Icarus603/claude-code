import { describe, expect, test } from 'bun:test'
import { FlushGate } from '../flushGate.js'

describe('FlushGate — initial state', () => {
  test('not active by default', () => {
    expect(new FlushGate<string>().active).toBe(false)
  })

  test('pendingCount = 0 by default', () => {
    expect(new FlushGate<string>().pendingCount).toBe(0)
  })
})

describe('FlushGate — start/enqueue/end lifecycle', () => {
  test('start() activates the gate', () => {
    const g = new FlushGate<string>()
    g.start()
    expect(g.active).toBe(true)
  })

  test('enqueue() returns false when not active (caller sends directly)', () => {
    const g = new FlushGate<string>()
    expect(g.enqueue('msg1')).toBe(false)
    expect(g.pendingCount).toBe(0)
  })

  test('enqueue() returns true when active and queues item', () => {
    const g = new FlushGate<string>()
    g.start()
    expect(g.enqueue('msg1')).toBe(true)
    expect(g.pendingCount).toBe(1)
  })

  test('enqueue() takes variadic items', () => {
    const g = new FlushGate<number>()
    g.start()
    expect(g.enqueue(1, 2, 3)).toBe(true)
    expect(g.pendingCount).toBe(3)
  })

  test('end() returns all queued items in order', () => {
    const g = new FlushGate<string>()
    g.start()
    g.enqueue('a')
    g.enqueue('b', 'c')
    expect(g.end()).toEqual(['a', 'b', 'c'])
  })

  test('end() deactivates the gate', () => {
    const g = new FlushGate<string>()
    g.start()
    g.end()
    expect(g.active).toBe(false)
  })

  test('end() empties the pending queue', () => {
    const g = new FlushGate<string>()
    g.start()
    g.enqueue('a')
    g.end()
    expect(g.pendingCount).toBe(0)
  })

  test('after end(), enqueue() returns false again', () => {
    const g = new FlushGate<string>()
    g.start()
    g.end()
    expect(g.enqueue('x')).toBe(false)
  })

  test('end() on a non-active gate returns empty array', () => {
    const g = new FlushGate<string>()
    expect(g.end()).toEqual([])
  })

  test('end() on active-but-empty gate returns empty array', () => {
    const g = new FlushGate<string>()
    g.start()
    expect(g.end()).toEqual([])
  })
})

describe('FlushGate — drop()', () => {
  test('drop() deactivates AND clears queue', () => {
    const g = new FlushGate<string>()
    g.start()
    g.enqueue('a', 'b')
    g.drop()
    expect(g.active).toBe(false)
    expect(g.pendingCount).toBe(0)
  })

  test('drop() returns count of dropped items', () => {
    const g = new FlushGate<string>()
    g.start()
    g.enqueue('a', 'b', 'c')
    expect(g.drop()).toBe(3)
  })

  test('drop() on empty gate returns 0', () => {
    const g = new FlushGate<string>()
    expect(g.drop()).toBe(0)
  })

  test('drop() on active-but-empty gate returns 0 + deactivates', () => {
    const g = new FlushGate<string>()
    g.start()
    expect(g.drop()).toBe(0)
    expect(g.active).toBe(false)
  })

  test('after drop(), gate is fully reset for reuse', () => {
    const g = new FlushGate<string>()
    g.start()
    g.enqueue('a')
    g.drop()
    // Now restart cleanly.
    g.start()
    expect(g.enqueue('b')).toBe(true)
    expect(g.end()).toEqual(['b'])
  })
})

describe('FlushGate — deactivate()', () => {
  test('deactivate() clears active flag WITHOUT dropping items', () => {
    // Critical: transport-replacement path. Items queued during the old
    // transport's flush must remain — the new transport's flush will
    // drain them. If deactivate() lost items, history would be missed.
    const g = new FlushGate<string>()
    g.start()
    g.enqueue('a', 'b')
    g.deactivate()
    expect(g.active).toBe(false)
    expect(g.pendingCount).toBe(2)
  })

  test('after deactivate(), end() still returns the items', () => {
    // The next start()/end() cycle must drain the carried-over items.
    const g = new FlushGate<string>()
    g.start()
    g.enqueue('first')
    g.deactivate()
    g.start()
    g.enqueue('second')
    expect(g.end()).toEqual(['first', 'second'])
  })

  test('deactivate() while inactive is a no-op', () => {
    const g = new FlushGate<string>()
    g.deactivate()
    expect(g.active).toBe(false)
    expect(g.pendingCount).toBe(0)
  })

  test('after deactivate(), enqueue() returns false (gate inactive)', () => {
    const g = new FlushGate<string>()
    g.start()
    g.enqueue('a')
    g.deactivate()
    expect(g.enqueue('b')).toBe(false) // not queued
    expect(g.pendingCount).toBe(1) // 'b' bypassed
  })
})

describe('FlushGate — multiple flush cycles', () => {
  test('start/end cycle is independent of previous state', () => {
    const g = new FlushGate<string>()
    g.start()
    g.enqueue('a')
    expect(g.end()).toEqual(['a'])
    g.start()
    g.enqueue('b')
    expect(g.end()).toEqual(['b'])
  })

  test('start() while already active is idempotent', () => {
    const g = new FlushGate<string>()
    g.start()
    g.enqueue('a')
    g.start() // re-start — should NOT clear the queue
    expect(g.pendingCount).toBe(1)
    expect(g.active).toBe(true)
  })
})

describe('FlushGate — generic type preservation', () => {
  test('numeric items preserved as numbers', () => {
    const g = new FlushGate<number>()
    g.start()
    g.enqueue(1, 2, 3)
    expect(g.end()).toEqual([1, 2, 3])
  })

  test('object items preserved by reference', () => {
    const a = { id: 1 }
    const b = { id: 2 }
    const g = new FlushGate<{ id: number }>()
    g.start()
    g.enqueue(a, b)
    const drained = g.end()
    expect(drained[0]).toBe(a) // same reference
    expect(drained[1]).toBe(b)
  })
})
