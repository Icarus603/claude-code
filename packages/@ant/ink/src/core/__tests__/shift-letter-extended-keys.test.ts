import { describe, expect, test } from 'bun:test'
import { InputEvent } from '../events/input-event.js'
import {
  INITIAL_STATE,
  parseMultipleKeypresses,
  type ParsedKey,
} from '../parse-keypress.js'

/**
 * Regression suite for the "shift+letter loses uppercase" bug that
 * surfaced when extended key reporting (Kitty CSI u + xterm modifyOtherKeys
 * level 2) was enabled on iTerm/kitty/WezTerm/Ghostty/tmux/Windows Terminal.
 *
 * Under those protocols, Shift+A no longer arrives on stdin as the byte
 * 'A' — instead the terminal sends `\x1b[65;2u` (CSI u) or
 * `\x1b[27;2;65~` (modifyOtherKeys). The parser decodes those into a
 * ParsedKey whose `name` is the lowercase keybinding identifier `'a'`
 * with `shift: true`. The InputEvent layer must then derive the
 * printable character `'A'` from (name='a', shift=true) — otherwise
 * text insertion downstream sees `input='a'` and the user types lowercase
 * with shift held.
 *
 * The two-tier contract these tests lock:
 *   - `keypress.name` / `key.shift` — keybinding identifiers, always
 *     lowercase letter + separate shift flag. Don't change this; many
 *     handlers check `key.name === 'a' && key.shift`.
 *   - `event.input` — printable character for text insertion. MUST be
 *     case-derived from (name, shift). This is the layer the bug fix
 *     restored.
 */

function parseOne(s: string): ParsedKey {
  const [keys] = parseMultipleKeypresses(INITIAL_STATE, s)
  const key = keys[0]
  if (!key || key.kind !== 'key') {
    throw new Error(`expected ParsedKey for ${JSON.stringify(s)}, got ${key?.kind}`)
  }
  return key
}

describe('shift+letter via extended key reporting', () => {
  describe('Kitty CSI u protocol', () => {
    test('Shift+A → printable "A" with shift flag', () => {
      // CSI u: codepoint=65 ('A'), modifier=2 (1+shift)
      const keypress = parseOne('\x1b[65;2u')
      expect(keypress.name).toBe('a') // keybinding id: lowercase
      expect(keypress.shift).toBe(true)

      const event = new InputEvent(keypress)
      expect(event.input).toBe('A') // printable: uppercase
      expect(event.key.shift).toBe(true)
    })

    test('Shift+Z → printable "Z"', () => {
      const keypress = parseOne('\x1b[90;2u')
      expect(keypress.name).toBe('z')
      const event = new InputEvent(keypress)
      expect(event.input).toBe('Z')
      expect(event.key.shift).toBe(true)
    })

    test('plain "a" (no modifier) stays lowercase', () => {
      // CSI u with codepoint=97 ('a'), modifier=1 (no mods)
      const keypress = parseOne('\x1b[97;1u')
      const event = new InputEvent(keypress)
      expect(event.input).toBe('a')
      expect(event.key.shift).toBe(false)
    })

    test('plain "a" via implicit modifier (no ; segment)', () => {
      // Modifier defaults to 1 when absent: CSI u codepoint only
      const keypress = parseOne('\x1b[97u')
      const event = new InputEvent(keypress)
      expect(event.input).toBe('a')
      expect(event.key.shift).toBe(false)
    })

    test('Ctrl+Shift+A: keybinding-shape input ("a" + flags)', () => {
      // modifier=6 = 1 + shift(1) + ctrl(4)
      // Ctrl-modified keys are keybinding territory, not text insertion.
      // input-event.ts:58 special-cases ctrl: `input = keypress.name`
      // (lowercase identifier) before the CSI u branch can rewrite it,
      // so handlers can match `key.ctrl && input === 'a'` regardless
      // of whether shift was also held. That's the intended contract;
      // this test locks it.
      const keypress = parseOne('\x1b[65;6u')
      expect(keypress.shift).toBe(true)
      expect(keypress.ctrl).toBe(true)
      const event = new InputEvent(keypress)
      expect(event.input).toBe('a') // keybinding id, NOT printable
      expect(event.key.shift).toBe(true)
      expect(event.key.ctrl).toBe(true)
    })
  })

  describe('xterm modifyOtherKeys protocol', () => {
    test('Shift+A → printable "A" with shift flag', () => {
      // modifyOtherKeys: ESC[27;modifier;keycode~ → ESC[27;2;65~
      const keypress = parseOne('\x1b[27;2;65~')
      expect(keypress.name).toBe('a') // keybinding id stays lowercase
      expect(keypress.shift).toBe(true)

      const event = new InputEvent(keypress)
      expect(event.input).toBe('A')
      expect(event.key.shift).toBe(true)
    })

    test('Shift+Z → printable "Z"', () => {
      const keypress = parseOne('\x1b[27;2;90~')
      const event = new InputEvent(keypress)
      expect(event.input).toBe('Z')
      expect(event.key.shift).toBe(true)
    })

    test('Alt+b (no shift) preserves lowercase', () => {
      // modifier=3 = 1 + alt(2). No shift.
      const keypress = parseOne('\x1b[27;3;98~')
      expect(keypress.name).toBe('b')
      expect(keypress.shift).toBe(false)
      const event = new InputEvent(keypress)
      // meta is set so this is a binding path; input still derives
      // correctly though (no shift → no upper-case).
      expect(event.input).toBe('b')
    })

    test('Shift+! and other shifted symbols are passed through', () => {
      // Terminals send the shifted symbol directly when modifyOtherKeys=2
      // is active — e.g. Shift+1 → keycode=33 ('!'). deriveShiftedInput
      // should not re-shift a non-letter.
      const keypress = parseOne('\x1b[27;2;33~')
      const event = new InputEvent(keypress)
      expect(event.input).toBe('!')
    })
  })

  describe('legacy raw byte path (extended keys disabled)', () => {
    test('raw "A" byte stays uppercase via sequence preservation', () => {
      // When extended keys aren't enabled, terminals send the literal
      // byte 'A' for Shift+A. parseKeypress sets name='a', shift=true,
      // but sequence='A' — and input-event.ts uses sequence (not name)
      // for non-CSI-u/non-modifyOtherKeys input. So this path was never
      // broken; this test guards against accidental regression.
      const keypress = parseOne('A')
      expect(keypress.name).toBe('a')
      expect(keypress.shift).toBe(true)
      expect(keypress.sequence).toBe('A')

      const event = new InputEvent(keypress)
      expect(event.input).toBe('A')
      expect(event.key.shift).toBe(true)
    })

    test('raw "a" byte stays lowercase', () => {
      const keypress = parseOne('a')
      const event = new InputEvent(keypress)
      expect(event.input).toBe('a')
      expect(event.key.shift).toBe(false)
    })
  })
})
