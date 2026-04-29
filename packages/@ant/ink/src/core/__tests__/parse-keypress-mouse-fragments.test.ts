import { describe, expect, test } from 'bun:test'
import { INITIAL_STATE, parseMultipleKeypresses } from '../parse-keypress.js'

describe('parse-keypress — SGR mouse fragment sanitizer', () => {
  // Captures the second-layer defense: even after the upstream tokenizer
  // drops partial CSI buffers on flush, multiple wheel events can pile up
  // in the same chunked-read race. The continuation chunks arrive as plain
  // text tokens whose char set is strictly the SGR mouse alphabet
  // ([<>;0-9Mm). The parse-keypress layer must drop these silently rather
  // than leak them as input.

  function feedAndDrainText(input: string): string[] {
    // Run input through parseMultipleKeypresses and return the user-visible
    // input strings produced (sequence values for sequences, raw for keys).
    let state = INITIAL_STATE
    const [keys, newState] = parseMultipleKeypresses(state, input)
    state = newState
    return keys.flatMap(k => {
      if (k.kind === 'key') return k.raw ?? k.sequence ?? ''
      if (k.kind === 'mouse') return [] // mouse events don't leak as text
      return []
    })
  }

  test('drops user-reported scroll-down garbage', () => {
    // Real-world capture from Icarus 2026-04-29: scroll-down only.
    // Expected: 0 visible keys produced from this fragment soup.
    const garbage = '[[<6[<66;[<66;94[<66;94;2[[<6[<66;94;26M6M'
    const visible = feedAndDrainText(garbage)
    // Filter out any pasted-key empties — only "leak" candidates count.
    const leaks = visible.filter(s => s && s.length > 0)
    expect(leaks).toEqual([])
  })

  test('drops short SGR terminator fragments (<digit>M/m)', () => {
    // Second-pass real-world capture: after Layer 1+2 caught the soup,
    // residual chunks like `9M`, `6M`, `6M9M` still leaked because they
    // were below length 3. The <digit>M/m heuristic catches them.
    for (const garbage of ['9M', '6M', '6M9M', '38m', '38M9m']) {
      const leaks = feedAndDrainText(garbage).filter(s => s && s.length > 0)
      expect(leaks).toEqual([])
    }
  })

  test('does NOT drop bare M / m / digits / brackets alone', () => {
    // Length-≤2 false-positive guard: bare letters and digits stay.
    for (const input of ['M', 'm', '<', '<<', '12', '99', 'MM']) {
      const leaks = feedAndDrainText(input).filter(s => s && s.length > 0)
      expect(leaks.length).toBeGreaterThan(0)
    }
  })

  test('drops fragment soup from sustained chunked wheel events', () => {
    // Sustained-scroll race: SGR events arrive interleaved with their own
    // chopped tails as one text chunk after upstream flush dropped the
    // ESC-anchored partials. Char set is strictly [<;0-9Mm] (and `[`).
    const garbage = '[[[<6[<65;[[[<6[<66;[<66;67;38M<65;67;38M67;38M<66;67;38M'
    const leaks = feedAndDrainText(garbage).filter(s => s && s.length > 0)
    expect(leaks).toEqual([])
  })

  test('does NOT drop pure digit text (real input)', () => {
    // "12345" is plausible real input — the SGR alphabet alone isn't
    // enough; the sanitizer requires at least one of < or M/m.
    const leaks = feedAndDrainText('12345').filter(s => s && s.length > 0)
    expect(leaks.join('')).toContain('1')
  })

  test('does NOT drop short text in the SGR alphabet', () => {
    // Length<3 falls through — typing ";M" or "<5" stays as input.
    const leaks = feedAndDrainText(';M').filter(s => s && s.length > 0)
    expect(leaks.length).toBeGreaterThan(0)
  })

  test('does NOT drop alphabetic text (no false positive on words)', () => {
    // Real prose includes letters outside the SGR alphabet — must pass through.
    const leaks = feedAndDrainText('hello').filter(s => s && s.length > 0)
    expect(leaks.join('')).toBe('hello')
  })

  test('does NOT drop mixed alphabet (prose with digits)', () => {
    // "M1" alone matches alphabet but we have 'h' in there → falls through.
    const leaks = feedAndDrainText('hM1').filter(s => s && s.length > 0)
    expect(leaks.join('')).toBe('hM1')
  })

  test('complete SGR mouse event still parses to a wheel key', () => {
    // Sanity: the fix mustn't break the happy path. ESC[<65;67;38M is a
    // wheel-down event — parse-keypress emits it as a key with name='wheeldown'.
    const [keys] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[<65;67;38M')
    expect(keys).toHaveLength(1)
    const k = keys[0]!
    expect(k.kind).toBe('key')
    if (k.kind === 'key') {
      expect(k.name).toBe('wheeldown')
    }
  })
})
