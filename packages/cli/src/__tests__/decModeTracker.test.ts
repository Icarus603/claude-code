import { describe, expect, test } from 'bun:test'
import { createDecModeTracker } from '../bg/decModeTracker.js'

describe('decModeTracker', () => {
  test('tracks single set+reset', () => {
    const t = createDecModeTracker()
    t.feed('\x1b[?1049h')
    expect(t.snapshot()).toEqual([1049])
    t.feed('\x1b[?1049l')
    expect(t.snapshot()).toEqual([])
  })

  test('tracks multi-id sets', () => {
    const t = createDecModeTracker()
    t.feed('\x1b[?1000;1002;1006h')
    expect(t.snapshot()).toEqual([1000, 1002, 1006])
  })

  test('restoreSequence emits inverse for still-enabled', () => {
    const t = createDecModeTracker()
    t.feed('\x1b[?25l\x1b[?1049h\x1b[?1000h\x1b[?2004h')
    // 25 was reset (cursor hidden), 1049 + 1000 + 2004 still set
    expect(t.snapshot()).toEqual([1000, 1049, 2004])
    // 1049 is sorted last so we exit alt-screen after restoring others
    expect(t.restoreSequence()).toBe('\x1b[?1000l\x1b[?2004l\x1b[?1049l')
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
