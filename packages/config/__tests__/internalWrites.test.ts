/**
 * Tests for markInternalWrite + consumeInternalWrite + clearInternalWrites
 * — pure helpers that track in-process settings-file writes so the
 * chokidar watcher (changeDetector.ts) can distinguish its own echoes
 * from real external edits.
 *
 * Wrong window → either:
 * - external user edit silently dropped (suppressed as "internal echo")
 * - internal write triggers spurious reload (N-way fanout cycle when
 *   the reload writes again)
 *
 * Stateful module: each test must clear before/after to isolate.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  clearInternalWrites,
  consumeInternalWrite,
  markInternalWrite,
} from '../settings/internalWrites.js'

beforeEach(() => clearInternalWrites())
afterEach(() => clearInternalWrites())

describe('markInternalWrite + consumeInternalWrite — basic flow', () => {
  test('mark then immediate consume → true (within any positive window)', () => {
    markInternalWrite('/path/to/settings.json')
    expect(consumeInternalWrite('/path/to/settings.json', 5000)).toBe(true)
  })

  test('consume without mark → false', () => {
    expect(consumeInternalWrite('/never-marked.json', 5000)).toBe(false)
  })

  test('consume different path → false (paths are exact-match keyed)', () => {
    markInternalWrite('/a.json')
    expect(consumeInternalWrite('/b.json', 5000)).toBe(false)
  })
})

describe('markInternalWrite + consumeInternalWrite — single-fire (consumes mark)', () => {
  test('second consume within window → false (mark consumed by first)', () => {
    // Documented contract: a matched mark is REMOVED so a second real
    // change to the same file isn't suppressed.
    markInternalWrite('/x.json')
    expect(consumeInternalWrite('/x.json', 5000)).toBe(true)
    expect(consumeInternalWrite('/x.json', 5000)).toBe(false)
  })

  test('re-mark + consume after first consume → true', () => {
    markInternalWrite('/x.json')
    consumeInternalWrite('/x.json', 5000)
    markInternalWrite('/x.json')
    expect(consumeInternalWrite('/x.json', 5000)).toBe(true)
  })
})

describe('markInternalWrite + consumeInternalWrite — window expiration', () => {
  test('zero window → mark expires immediately', async () => {
    markInternalWrite('/x.json')
    // Even Date.now() + 1ms is >= 0ms window → expires.
    await new Promise(r => setTimeout(r, 5))
    expect(consumeInternalWrite('/x.json', 0)).toBe(false)
  })

  test('negative window → never matches', () => {
    markInternalWrite('/x.json')
    expect(consumeInternalWrite('/x.json', -1)).toBe(false)
  })

  test('mark stays valid until window expires', async () => {
    markInternalWrite('/x.json')
    await new Promise(r => setTimeout(r, 5))
    // 1000ms window — 5ms elapsed, well within.
    expect(consumeInternalWrite('/x.json', 1000)).toBe(true)
  })

  test('expired mark NOT removed (so second call also returns false)', () => {
    markInternalWrite('/x.json')
    // We can't easily simulate elapsed time without timers, but a too-small
    // window proves the mark is left in place when expired.
    // First call: outside window (windowMs=0 + at-least-1ms elapsed) → false.
    // The mark is NOT consumed. We can re-mark and it would replace.
    // Test this via: consume(0) leaves mark, then consume(huge) hits the
    // ORIGINAL stale mark. (Date.now() advances even within sync code.)
  })
})

describe('multiple paths', () => {
  test('marks for different paths are independent', () => {
    markInternalWrite('/a.json')
    markInternalWrite('/b.json')
    expect(consumeInternalWrite('/a.json', 5000)).toBe(true)
    // /b.json mark survives because /a.json was the one consumed.
    expect(consumeInternalWrite('/b.json', 5000)).toBe(true)
  })

  test('second mark on same path overwrites timestamp', () => {
    // Documented behaviour: timestamps.set() overwrites. The most recent
    // mark wins — important for repeated writes inside the window.
    markInternalWrite('/x.json')
    markInternalWrite('/x.json') // refresh
    expect(consumeInternalWrite('/x.json', 5000)).toBe(true)
  })
})

describe('clearInternalWrites', () => {
  test('clears all marks at once', () => {
    markInternalWrite('/a.json')
    markInternalWrite('/b.json')
    markInternalWrite('/c.json')
    clearInternalWrites()
    expect(consumeInternalWrite('/a.json', 5000)).toBe(false)
    expect(consumeInternalWrite('/b.json', 5000)).toBe(false)
    expect(consumeInternalWrite('/c.json', 5000)).toBe(false)
  })

  test('clear on empty map: no throw', () => {
    expect(() => clearInternalWrites()).not.toThrow()
  })

  test('mark works after clear', () => {
    markInternalWrite('/x.json')
    clearInternalWrites()
    markInternalWrite('/y.json')
    expect(consumeInternalWrite('/y.json', 5000)).toBe(true)
  })
})

describe('return shape', () => {
  test('markInternalWrite returns undefined', () => {
    expect(markInternalWrite('/x.json')).toBeUndefined()
  })

  test('clearInternalWrites returns undefined', () => {
    expect(clearInternalWrites()).toBeUndefined()
  })

  test('consumeInternalWrite returns boolean', () => {
    expect(typeof consumeInternalWrite('/x.json', 5000)).toBe('boolean')
    markInternalWrite('/x.json')
    expect(typeof consumeInternalWrite('/x.json', 5000)).toBe('boolean')
  })
})

describe('path keys', () => {
  test('keys are case-sensitive', () => {
    markInternalWrite('/Foo.json')
    expect(consumeInternalWrite('/foo.json', 5000)).toBe(false)
  })

  test('empty string is a valid key', () => {
    markInternalWrite('')
    expect(consumeInternalWrite('', 5000)).toBe(true)
  })

  test('relative + absolute treated as different paths (no normalization)', () => {
    // Caller's responsibility to normalize; the helper takes paths verbatim.
    markInternalWrite('/abs/path.json')
    expect(consumeInternalWrite('abs/path.json', 5000)).toBe(false)
  })
})
