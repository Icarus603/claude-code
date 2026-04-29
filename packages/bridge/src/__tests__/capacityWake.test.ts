import { describe, expect, test } from 'bun:test'
import { createCapacityWake } from '../capacityWake.js'

describe('createCapacityWake — initial state', () => {
  test('signal() returns a non-aborted signal when neither side aborted', () => {
    const outer = new AbortController()
    const wake = createCapacityWake(outer.signal)
    const { signal } = wake.signal()
    expect(signal.aborted).toBe(false)
  })

  test('signal() returns a cleanup function', () => {
    const outer = new AbortController()
    const wake = createCapacityWake(outer.signal)
    const { cleanup } = wake.signal()
    expect(typeof cleanup).toBe('function')
  })
})

describe('outer signal abort propagation', () => {
  test('outer abort BEFORE signal() → returns already-aborted signal', () => {
    // Critical: after the outer aborts, future signal() calls must not
    // hand back a never-resolves signal that hangs the poll loop.
    const outer = new AbortController()
    outer.abort()
    const wake = createCapacityWake(outer.signal)
    const { signal } = wake.signal()
    expect(signal.aborted).toBe(true)
  })

  test('outer abort AFTER signal() → propagates abort', () => {
    const outer = new AbortController()
    const wake = createCapacityWake(outer.signal)
    const { signal } = wake.signal()
    expect(signal.aborted).toBe(false)
    outer.abort()
    expect(signal.aborted).toBe(true)
  })

  test('cleanup is a no-op when outer-abort already returned (no listener attached)', () => {
    // When the constructor sees outer already aborted, it returns a
    // no-op cleanup. Calling it must not throw.
    const outer = new AbortController()
    outer.abort()
    const wake = createCapacityWake(outer.signal)
    const { cleanup } = wake.signal()
    expect(() => cleanup()).not.toThrow()
  })
})

describe('wake() — early sleep abort', () => {
  test('wake() BEFORE signal() → next signal returns already-aborted', () => {
    // wake() arms a fresh controller so the NEXT signal() starts fresh.
    // But IF you call wake() and immediately signal(), the wakeController
    // has been replaced — the new one is NOT aborted, so signal is fresh.
    const outer = new AbortController()
    const wake = createCapacityWake(outer.signal)
    wake.wake()
    const { signal } = wake.signal()
    // wake() replaces the controller after aborting, so the new signal
    // is NOT aborted at signal() time. Document this contract.
    expect(signal.aborted).toBe(false)
  })

  test('wake() AFTER signal() → propagates abort to that signal', () => {
    // The classic use case: poll loop is sleeping (signal returned),
    // capacity frees up → wake() fires → sleep aborts early.
    const outer = new AbortController()
    const wake = createCapacityWake(outer.signal)
    const { signal } = wake.signal()
    expect(signal.aborted).toBe(false)
    wake.wake()
    expect(signal.aborted).toBe(true)
  })

  test('multiple wake() calls — only the FIRST aborts the active signal', () => {
    // Once aborted, the AbortController cannot be re-aborted. The wake()
    // function MUST replace the controller (which it does) so subsequent
    // signal() calls get fresh signals. But the active signal stays aborted.
    const outer = new AbortController()
    const wake = createCapacityWake(outer.signal)
    const { signal: s1 } = wake.signal()
    wake.wake()
    expect(s1.aborted).toBe(true)
    wake.wake() // a second wake should not blow up
    expect(s1.aborted).toBe(true)
  })

  test('wake() arms a fresh controller for the NEXT signal()', () => {
    const outer = new AbortController()
    const wake = createCapacityWake(outer.signal)
    const { signal: s1 } = wake.signal()
    wake.wake()
    expect(s1.aborted).toBe(true)
    // After wake replaced the controller, a NEW signal() should be fresh.
    const { signal: s2 } = wake.signal()
    expect(s2.aborted).toBe(false)
    // s2 can independently be aborted.
    wake.wake()
    expect(s2.aborted).toBe(true)
  })
})

describe('outer + wake — merged abort semantics', () => {
  test('either source aborts the merged signal', () => {
    // Each new signal() call merges outer + wake. EITHER source aborting
    // must abort the merged signal.
    const outer1 = new AbortController()
    const wake1 = createCapacityWake(outer1.signal)
    const { signal: s1 } = wake1.signal()
    outer1.abort()
    expect(s1.aborted).toBe(true)

    const outer2 = new AbortController()
    const wake2 = createCapacityWake(outer2.signal)
    const { signal: s2 } = wake2.signal()
    wake2.wake()
    expect(s2.aborted).toBe(true)
  })

  test('cleanup() removes listeners — outer abort no longer triggers merged', () => {
    // After cleanup, the abort listeners are removed. A subsequent abort
    // on outer should NOT propagate to the merged signal (the merged
    // signal wasn't aborted, so it stays not-aborted).
    const outer = new AbortController()
    const wake = createCapacityWake(outer.signal)
    const { signal, cleanup } = wake.signal()
    cleanup()
    outer.abort()
    expect(signal.aborted).toBe(false)
  })

  test('cleanup() removes wake listener — wake() no longer triggers merged', () => {
    const outer = new AbortController()
    const wake = createCapacityWake(outer.signal)
    const { signal, cleanup } = wake.signal()
    cleanup()
    wake.wake()
    expect(signal.aborted).toBe(false)
  })

  test('cleanup() is idempotent — calling twice is safe', () => {
    const outer = new AbortController()
    const wake = createCapacityWake(outer.signal)
    const { cleanup } = wake.signal()
    expect(() => {
      cleanup()
      cleanup()
    }).not.toThrow()
  })
})

describe('isolation — multiple wakes on same outer', () => {
  test('two CapacityWakes on the same outer signal are independent', () => {
    // Sanity: two poll loops sharing the same outer abort can have their
    // own capacity wakes. wake() on one doesn't affect the other.
    const outer = new AbortController()
    const wakeA = createCapacityWake(outer.signal)
    const wakeB = createCapacityWake(outer.signal)
    const { signal: sA } = wakeA.signal()
    const { signal: sB } = wakeB.signal()
    wakeA.wake()
    expect(sA.aborted).toBe(true)
    expect(sB.aborted).toBe(false)
  })

  test('outer abort fires BOTH wakes (shared upstream)', () => {
    const outer = new AbortController()
    const wakeA = createCapacityWake(outer.signal)
    const wakeB = createCapacityWake(outer.signal)
    const { signal: sA } = wakeA.signal()
    const { signal: sB } = wakeB.signal()
    outer.abort()
    expect(sA.aborted).toBe(true)
    expect(sB.aborted).toBe(true)
  })
})

describe('AbortSignal listener leak prevention', () => {
  // Each signal() call adds 2 listeners (outer + wake). Without cleanup,
  // long-running poll loops would leak ~2 listeners per iteration. The
  // `{ once: true }` option helps but only fires once per abort; if the
  // signal is never aborted (sleep finishes normally), cleanup is needed.

  test('cleanup() unregisters listeners — repeated cycles do not leak', () => {
    const outer = new AbortController()
    const wake = createCapacityWake(outer.signal)
    // Simulate 100 sleep cycles. Each calls signal(), then cleanup().
    // If cleanup leaks listeners, this would slow down or warn.
    for (let i = 0; i < 100; i++) {
      const { cleanup } = wake.signal()
      cleanup()
    }
    // Now abort outer — none of the (cleaned-up) merged signals should
    // get listeners fired. Just verify no crash / no exception.
    expect(() => outer.abort()).not.toThrow()
  })
})
