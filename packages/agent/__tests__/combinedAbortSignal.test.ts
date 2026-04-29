import { describe, expect, test } from 'bun:test'
import { createCombinedAbortSignal } from '../combinedAbortSignal.js'

describe('createCombinedAbortSignal — single signal', () => {
  test('returns a non-aborted signal when input signal is undefined and not yet aborted', () => {
    const { signal, cleanup } = createCombinedAbortSignal(undefined)
    expect(signal.aborted).toBe(false)
    cleanup()
  })

  test('aborting the input signal aborts the combined', () => {
    const c = new AbortController()
    const { signal, cleanup } = createCombinedAbortSignal(c.signal)
    expect(signal.aborted).toBe(false)
    c.abort()
    expect(signal.aborted).toBe(true)
    cleanup()
  })

  test('returns already-aborted when input is pre-aborted', () => {
    const c = new AbortController()
    c.abort()
    const { signal, cleanup } = createCombinedAbortSignal(c.signal)
    expect(signal.aborted).toBe(true)
    cleanup()
  })
})

describe('createCombinedAbortSignal — second signal', () => {
  test('aborting signalB aborts the combined', () => {
    const a = new AbortController()
    const b = new AbortController()
    const { signal, cleanup } = createCombinedAbortSignal(a.signal, {
      signalB: b.signal,
    })
    expect(signal.aborted).toBe(false)
    b.abort()
    expect(signal.aborted).toBe(true)
    cleanup()
  })

  test('returns pre-aborted when signalB is pre-aborted (even if signal is fresh)', () => {
    const a = new AbortController()
    const b = new AbortController()
    b.abort()
    const { signal, cleanup } = createCombinedAbortSignal(a.signal, {
      signalB: b.signal,
    })
    expect(signal.aborted).toBe(true)
    cleanup()
  })

  test('aborting signal A aborts even when signalB is healthy', () => {
    const a = new AbortController()
    const b = new AbortController()
    const { signal, cleanup } = createCombinedAbortSignal(a.signal, {
      signalB: b.signal,
    })
    a.abort()
    expect(signal.aborted).toBe(true)
    expect(b.signal.aborted).toBe(false)
    cleanup()
  })
})

describe('createCombinedAbortSignal — timeout', () => {
  test('does not abort before timeoutMs elapses', async () => {
    const { signal, cleanup } = createCombinedAbortSignal(undefined, {
      timeoutMs: 100,
    })
    expect(signal.aborted).toBe(false)
    cleanup()
  })

  test('aborts after timeoutMs elapses', async () => {
    const { signal, cleanup } = createCombinedAbortSignal(undefined, {
      timeoutMs: 5,
    })
    expect(signal.aborted).toBe(false)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(signal.aborted).toBe(true)
    cleanup()
  })

  test('cleanup before timeout prevents abort', async () => {
    const { signal, cleanup } = createCombinedAbortSignal(undefined, {
      timeoutMs: 30,
    })
    cleanup()
    await new Promise(resolve => setTimeout(resolve, 60))
    // Signal should still NOT be aborted, because cleanup cleared the timer.
    expect(signal.aborted).toBe(false)
  })
})

describe('createCombinedAbortSignal — cleanup', () => {
  test('cleanup is callable multiple times safely', () => {
    const c = new AbortController()
    const { cleanup } = createCombinedAbortSignal(c.signal)
    cleanup()
    cleanup()
    cleanup()
    // Should not throw.
    expect(true).toBe(true)
  })

  test('cleanup removes abort listener from input signal', () => {
    // No direct way to count listeners, but we can verify the
    // combined signal does NOT abort after cleanup if input aborts.
    const c = new AbortController()
    const { signal, cleanup } = createCombinedAbortSignal(c.signal)
    cleanup()
    // After cleanup, the listener is gone, so aborting the input
    // should NOT trigger the combined.
    // Note: there's a subtlety — the combined controller still
    // exists, so aborting it directly would still work. But the
    // input signal's abort cannot reach it anymore.
    c.abort()
    // The combined has its own controller, so aborting input no
    // longer propagates after cleanup.
    expect(signal.aborted).toBe(false)
  })

  test('cleanup is a no-op when both signals are already aborted', () => {
    const c = new AbortController()
    c.abort()
    const { cleanup } = createCombinedAbortSignal(c.signal)
    expect(() => cleanup()).not.toThrow()
  })
})

describe('createCombinedAbortSignal — combined behavior', () => {
  test('first abort wins (signal aborts before signalB)', () => {
    const a = new AbortController()
    const b = new AbortController()
    const { signal, cleanup } = createCombinedAbortSignal(a.signal, {
      signalB: b.signal,
    })
    a.abort()
    b.abort()
    expect(signal.aborted).toBe(true)
    cleanup()
  })

  test('first abort wins (signalB aborts before signal)', () => {
    const a = new AbortController()
    const b = new AbortController()
    const { signal, cleanup } = createCombinedAbortSignal(a.signal, {
      signalB: b.signal,
    })
    b.abort()
    a.abort()
    expect(signal.aborted).toBe(true)
    cleanup()
  })

  test('all three triggers (signal, signalB, timeout) coexist', async () => {
    const a = new AbortController()
    const b = new AbortController()
    const { signal, cleanup } = createCombinedAbortSignal(a.signal, {
      signalB: b.signal,
      timeoutMs: 5,
    })
    expect(signal.aborted).toBe(false)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(signal.aborted).toBe(true)
    cleanup()
  })
})
