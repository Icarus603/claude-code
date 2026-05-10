import { nonAlphanumericKeys, type ParsedKey } from '../parse-keypress.js'
import { Event } from './event.js'

/**
 * Derive the printable character a user expects to type from a key that
 * came in via CSI u / modifyOtherKeys.
 *
 * Background: `keypress.name` from parse-keypress.ts is a keybinding
 * identifier — letters are always lowercase, with `shift` carried as a
 * separate flag. That's correct for `key.name === 'a'` style handlers,
 * but wrong for text insertion: Shift+A should insert `'A'`, not `'a'`.
 *
 * On the raw `s.length === 1 && s >= 'A' && s <= 'Z'` path the original
 * sequence preserves case (input-event.ts uses `keypress.sequence`), so
 * shift+letter works without intervention. But the CSI u and
 * modifyOtherKeys branches discard the sequence (it's an unprintable
 * escape sequence like `\x1b[27;2;65~`) and substitute `keypress.name`
 * — which is the lowercase keybinding id. Without this derivation the
 * 'A' becomes an 'a' the user can't fix by holding shift harder.
 *
 * Letter casing only — number-row shift symbols (Shift+1 → '!') depend
 * on keyboard layout and aren't carried in the protocol. Terminals that
 * implement modifyOtherKeys correctly already send the shifted symbol
 * directly (keycode 33 for '!'), bypassing this path. The lower-letter
 * gap is the actual reported failure.
 */
function deriveShiftedInput(input: string, shift: boolean): string {
  if (!shift) return input
  if (input.length !== 1) return input
  if (input >= 'a' && input <= 'z') return input.toUpperCase()
  return input
}

export type Key = {
  upArrow: boolean
  downArrow: boolean
  leftArrow: boolean
  rightArrow: boolean
  pageDown: boolean
  pageUp: boolean
  wheelUp: boolean
  wheelDown: boolean
  home: boolean
  end: boolean
  return: boolean
  escape: boolean
  ctrl: boolean
  shift: boolean
  fn: boolean
  tab: boolean
  backspace: boolean
  delete: boolean
  meta: boolean
  super: boolean
}

function parseKey(keypress: ParsedKey): [Key, string] {
  const key: Key = {
    upArrow: keypress.name === 'up',
    downArrow: keypress.name === 'down',
    leftArrow: keypress.name === 'left',
    rightArrow: keypress.name === 'right',
    pageDown: keypress.name === 'pagedown',
    pageUp: keypress.name === 'pageup',
    wheelUp: keypress.name === 'wheelup',
    wheelDown: keypress.name === 'wheeldown',
    home: keypress.name === 'home',
    end: keypress.name === 'end',
    return: keypress.name === 'return',
    escape: keypress.name === 'escape',
    fn: keypress.fn,
    ctrl: keypress.ctrl,
    shift: keypress.shift,
    tab: keypress.name === 'tab',
    backspace: keypress.name === 'backspace',
    delete: keypress.name === 'delete',
    // `parseKeypress` parses \u001B\u001B[A (meta + up arrow) as meta = false
    // but with option = true, so we need to take this into account here
    // to avoid breaking changes in Ink.
    // TODO(vadimdemedes): consider removing this in the next major version.
    meta: keypress.meta || keypress.name === 'escape' || keypress.option,
    // Super (Cmd on macOS / Win key) — only arrives via kitty keyboard
    // protocol CSI u sequences. Distinct from meta (Alt/Option) so
    // bindings like cmd+c can be expressed separately from opt+c.
    super: keypress.super,
  }

  let input = keypress.ctrl ? keypress.name : keypress.sequence

  // Handle undefined input case
  if (input === undefined) {
    input = ''
  }

  // When ctrl is set, keypress.name for space is the literal word "space".
  // Convert to actual space character for consistency with the CSI u branch
  // (which maps 'space' → ' '). Without this, ctrl+space leaks the literal
  // word "space" into text input.
  if (keypress.ctrl && input === 'space') {
    input = ' '
  }

  // Suppress unrecognized escape sequences that were parsed as function keys
  // (matched by FN_KEY_RE) but have no name in the keyName map.
  // Examples: ESC[25~ (F13/Right Alt on Windows), ESC[26~ (F14), etc.
  // Without this, the ESC prefix is stripped below and the remainder (e.g.,
  // "[25~") leaks into the input as literal text.
  if (keypress.code && !keypress.name) {
    input = ''
  }

  // Suppress ESC-less SGR mouse fragments. When a heavy React commit blocks
  // the event loop past App's 50ms NORMAL_TIMEOUT flush, a CSI split across
  // stdin chunks gets its buffered ESC flushed as a lone Escape key, and the
  // continuation arrives as a text token with name='' — which falls through
  // all of parseKeypress's ESC-anchored regexes and the nonAlphanumericKeys
  // clear below (name is falsy). The fragment then leaks into the prompt as
  // literal `[<64;74;16M`. This is the same defensive sink as the F13 guard
  // above; the underlying tokenizer-flush race is upstream of this layer.
  if (!keypress.name && /^\[<\d+;\d+;\d+[Mm]/.test(input)) {
    input = ''
  }

  // Strip meta if it's still remaining after `parseKeypress`
  // TODO(vadimdemedes): remove this in the next major version.
  if (input.startsWith('\u001B')) {
    input = input.slice(1)
  }

  // Track whether we've already processed this as a special sequence
  // that converted input to the key name (CSI u or application keypad mode).
  // For these, we don't want to clear input with nonAlphanumericKeys check.
  let processedAsSpecialSequence = false

  // Handle CSI u sequences (Kitty keyboard protocol): after stripping ESC,
  // we're left with "[codepoint;modifieru" (e.g., "[98;3u" for Alt+b).
  // Use the parsed key name instead for input handling. Require a digit
  // after [ — real CSI u is always [<digits>…u, and a bare startsWith('[')
  // false-matches X10 mouse at row 85 (Cy = 85+32 = 'u'), leaking the
  // literal text "mouse" into the prompt via processedAsSpecialSequence.
  if (/^\[\d/.test(input) && input.endsWith('u')) {
    if (!keypress.name) {
      // Unmapped Kitty functional key (Caps Lock 57358, F13–F35, KP nav,
      // bare modifiers, etc.) — keycodeToName() returned undefined. Swallow
      // so the raw "[57358u" doesn't leak into the prompt. See #38781.
      input = ''
    } else {
      // 'space' → ' '; 'escape' → '' (key.escape carries it;
      // processedAsSpecialSequence bypasses the nonAlphanumericKeys
      // clear below, so we must handle it explicitly here);
      // otherwise use key name. `keypress.name` from CSI u is a
      // keybinding identifier (always lowercase for letters), so we
      // apply shift-derivation to recover the printable character —
      // otherwise Shift+A would insert 'a'. See deriveShiftedInput.
      input =
        keypress.name === 'space'
          ? ' '
          : keypress.name === 'escape'
            ? ''
            : deriveShiftedInput(keypress.name, keypress.shift)
    }
    processedAsSpecialSequence = true
  }

  // Handle xterm modifyOtherKeys sequences: after stripping ESC, we're left
  // with "[27;modifier;keycode~" (e.g., "[27;3;98~" for Alt+b). Same
  // extraction as CSI u — without this, printable-char keycodes (single-letter
  // names) skip the nonAlphanumericKeys clear and leak "[27;..." as input.
  if (input.startsWith('[27;') && input.endsWith('~')) {
    if (!keypress.name) {
      // Unmapped modifyOtherKeys keycode — swallow for consistency with
      // the CSI u handler above. Practically untriggerable today (xterm
      // modifyOtherKeys only sends ASCII keycodes, all mapped), but
      // guards against future terminal behavior.
      input = ''
    } else {
      // Apply shift-derivation for the same reason as the CSI u branch
      // above — without it, Shift+A via modifyOtherKeys inserts 'a'.
      input =
        keypress.name === 'space'
          ? ' '
          : keypress.name === 'escape'
            ? ''
            : deriveShiftedInput(keypress.name, keypress.shift)
    }
    processedAsSpecialSequence = true
  }

  // Handle application keypad mode sequences: after stripping ESC,
  // we're left with "O<letter>" (e.g., "Op" for numpad 0, "Oy" for numpad 9).
  // Use the parsed key name (the digit character) for input handling.
  if (
    input.startsWith('O') &&
    input.length === 2 &&
    keypress.name &&
    keypress.name.length === 1
  ) {
    input = keypress.name
    processedAsSpecialSequence = true
  }

  // Clear input for non-alphanumeric keys (arrows, function keys, etc.)
  // Skip this for CSI u and application keypad mode sequences since
  // those were already converted to their proper input characters.
  if (
    !processedAsSpecialSequence &&
    keypress.name &&
    nonAlphanumericKeys.includes(keypress.name)
  ) {
    input = ''
  }

  // Set shift=true for uppercase letters (A-Z)
  // Must check it's actually a letter, not just any char unchanged by toUpperCase
  if (
    input.length === 1 &&
    typeof input[0] === 'string' &&
    input[0] >= 'A' &&
    input[0] <= 'Z'
  ) {
    key.shift = true
  }

  return [key, input]
}

export class InputEvent extends Event {
  readonly keypress: ParsedKey
  readonly key: Key
  readonly input: string

  constructor(keypress: ParsedKey) {
    super()
    const [key, input] = parseKey(keypress)

    this.keypress = keypress
    this.key = key
    this.input = input
  }
}
