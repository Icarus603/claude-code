import { describe, expect, test } from 'bun:test'
import { createTokenizer } from '../tokenize.js'

describe('tokenize — flush behavior on incomplete sequences', () => {
  // Race scenario: a heavy React commit blocks the event loop past App's
  // 50ms NORMAL_TIMEOUT, and the SGR mouse wheel event \x1b[<65;67;38M
  // arrives split across stdin reads. The flush must NOT emit the partial
  // CSI body, otherwise downstream parse-keypress can't recognize it and
  // it leaks into the prompt as visible garbage like `[<6` / `5;67;38M`.

  test('drops partial CSI buffer on flush (no garbage leak)', () => {
    const tok = createTokenizer({ x10Mouse: true })
    // First chunk: ESC [ < 6 — buffered in csi state
    const tokens1 = tok.feed('\x1b[<6')
    expect(tokens1).toEqual([])
    expect(tok.buffer()).toBe('\x1b[<6')

    // Forced flush before the rest arrives — must produce no tokens
    const flushed = tok.flush()
    expect(flushed).toEqual([])
    expect(tok.buffer()).toBe('')
  })

  test('drops partial OSC/DCS/APC buffers on flush', () => {
    for (const partial of ['\x1b]11;rgb', '\x1bP>|ghost', '\x1b_xyz']) {
      const tok = createTokenizer({ x10Mouse: true })
      tok.feed(partial)
      expect(tok.flush()).toEqual([])
      expect(tok.buffer()).toBe('')
    }
  })

  test('preserves lone ESC keypress on flush', () => {
    // A real Escape keypress sits in the 'escape' state for App's 50ms
    // NORMAL_TIMEOUT before the flush emits it. Dropping this would
    // silently eat the user's Escape key — only multi-byte
    // machine-generated sequences should be discarded.
    const tok = createTokenizer({ x10Mouse: true })
    tok.feed('\x1b')
    const flushed = tok.flush()
    expect(flushed).toEqual([{ type: 'sequence', value: '\x1b' }])
    expect(tok.buffer()).toBe('')
  })

  test('preserves ESC + printable (Alt+letter) on flush', () => {
    // ESC + a sits in 'escape' state until the parser decides it's a 2-char
    // meta sequence (Alt+a). Same drop semantic as lone ESC: must emit.
    const tok = createTokenizer({ x10Mouse: true })
    tok.feed('\x1b')
    // (no follow-up; flush should still emit just the ESC)
    expect(tok.flush()).toEqual([{ type: 'sequence', value: '\x1b' }])
  })

  test('complete CSI sequences flush normally', () => {
    // Sanity: a complete sequence inside the same feed should still emit.
    const tok = createTokenizer({ x10Mouse: true })
    const tokens = tok.feed('\x1b[<65;67;38M')
    expect(tokens).toEqual([
      { type: 'sequence', value: '\x1b[<65;67;38M' },
    ])
    expect(tok.buffer()).toBe('')
  })

  test('split CSI sequence completes when both halves are fed (no flush)', () => {
    // Without an intervening flush, a split sequence still re-assembles
    // correctly via the buffer mechanism.
    const tok = createTokenizer({ x10Mouse: true })
    expect(tok.feed('\x1b[<6')).toEqual([])
    expect(tok.feed('5;67;38M')).toEqual([
      { type: 'sequence', value: '\x1b[<65;67;38M' },
    ])
  })
})
