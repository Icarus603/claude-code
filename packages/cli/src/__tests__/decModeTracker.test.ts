import { describe, expect, test } from 'bun:test'
import { createDecModeTracker } from '../bg/decModeTracker.js'

describe('decModeTracker', () => {
  // Source: ant 4767.js sNK allowlist: {1000, 1002, 1003, 1004, 1006, 2004, 2031}.
  // Modes outside the allowlist (1049 alt-screen, 25 cursor visibility,
  // 1 DECCKM, etc.) are owned by the OUTER caller — tracker must NOT
  // observe them or detach would emit a stray exit-alt sequence.
  test('IGNORES 1049 (alt-screen) — outside ant sNK allowlist', () => {
    const t = createDecModeTracker()
    t.feed('\x1b[?1049h')
    expect(t.snapshot()).toEqual([])
    t.feed('\x1b[?1049l')
    expect(t.snapshot()).toEqual([])
  })

  test('tracks single set+reset for allowlisted mode', () => {
    const t = createDecModeTracker()
    t.feed('\x1b[?1000h')
    expect(t.snapshot()).toEqual([1000])
    t.feed('\x1b[?1000l')
    expect(t.snapshot()).toEqual([])
  })

  test('tracks multi-id sets — all allowlisted', () => {
    const t = createDecModeTracker()
    t.feed('\x1b[?1000;1002;1006h')
    expect(t.snapshot()).toEqual([1000, 1002, 1006])
  })

  test('restoreSequence emits inverse for still-enabled (allowlisted only)', () => {
    const t = createDecModeTracker()
    // 25 (not in allowlist) + 1049 (not in allowlist) + 1000 (tracked) +
    // 2004 (tracked). Only 1000 + 2004 should be observable.
    t.feed('\x1b[?25l\x1b[?1049h\x1b[?1000h\x1b[?2004h')
    expect(t.snapshot()).toEqual([1000, 2004])
    // Source: ant 4767.js `E.snapshot().map(bF).reverse().join("")` —
    // reverse-sorted (largest id first). 2004 → 1000.
    expect(t.restoreSequence()).toBe('\x1b[?2004l\x1b[?1000l')
  })

  test('handles Buffer input', () => {
    const t = createDecModeTracker()
    t.feed(Buffer.from('\x1b[?1004h'))
    expect(t.snapshot()).toEqual([1004])
  })

  test('ignores non-DEC CSI sequences', () => {
    const t = createDecModeTracker()
    t.feed('\x1b[2J\x1b[H\x1b[1mhello\x1b[0m')
    expect(t.snapshot()).toEqual([])
  })

  test('survives partial sequence at chunk boundary', () => {
    // Imperfect — current implementation doesn't handle splits — but
    // confirm no crash/infinite-loop. The single-chunk test cases above
    // verify the happy path.
    const t = createDecModeTracker()
    expect(() => t.feed('\x1b[?100')).not.toThrow()
    expect(() => t.feed('0h')).not.toThrow()
  })

  test('restoreSequence on empty tracker is empty', () => {
    const t = createDecModeTracker()
    expect(t.restoreSequence()).toBe('')
  })
})
