/**
 * Tests for PromptInput mode helpers.
 *
 * These trivial-looking helpers gate the bash-mode prefix (`!ls -la`)
 * detection that drives the input UI's red-tinted bash banner.
 *
 * A regression in getModeFromInput silently flips bash-mode UX off;
 * a regression in prependModeCharacterToInput emits the wrong on-wire
 * format which the back-end rejects as not-a-prompt.
 */
import { describe, expect, test } from 'bun:test'
import {
  getModeFromInput,
  getValueFromInput,
  isInputModeCharacter,
  prependModeCharacterToInput,
} from '../components/PromptInput/inputModes.js'

describe('prependModeCharacterToInput', () => {
  test('bash mode prepends !', () => {
    expect(prependModeCharacterToInput('ls -la', 'bash' as never)).toBe(
      '!ls -la',
    )
  })

  test('prompt mode passes through unchanged', () => {
    expect(prependModeCharacterToInput('hello', 'prompt' as never)).toBe(
      'hello',
    )
  })

  test('unknown mode passes through unchanged (default branch)', () => {
    expect(prependModeCharacterToInput('hi', 'whatever' as never)).toBe('hi')
  })

  test('bash mode + empty string → just !', () => {
    expect(prependModeCharacterToInput('', 'bash' as never)).toBe('!')
  })
})

describe('getModeFromInput', () => {
  test('input starting with ! → bash', () => {
    expect(getModeFromInput('!ls -la')).toBe('bash')
  })

  test('input without ! → prompt', () => {
    expect(getModeFromInput('hello world')).toBe('prompt')
  })

  test('empty string → prompt', () => {
    expect(getModeFromInput('')).toBe('prompt')
  })

  test('lone ! character → bash', () => {
    expect(getModeFromInput('!')).toBe('bash')
  })

  test('!! produces bash (only first char checked)', () => {
    expect(getModeFromInput('!!')).toBe('bash')
  })

  test('whitespace before ! → prompt (strict startsWith)', () => {
    expect(getModeFromInput(' !ls')).toBe('prompt')
  })
})

describe('getValueFromInput', () => {
  test('bash input strips leading !', () => {
    expect(getValueFromInput('!ls -la')).toBe('ls -la')
  })

  test('prompt input passes through', () => {
    expect(getValueFromInput('hello')).toBe('hello')
  })

  test('lone ! returns empty', () => {
    expect(getValueFromInput('!')).toBe('')
  })

  test('!! returns ! (only one char stripped)', () => {
    expect(getValueFromInput('!!')).toBe('!')
  })

  test('empty input → empty', () => {
    expect(getValueFromInput('')).toBe('')
  })
})

describe('isInputModeCharacter', () => {
  test('exact ! → true', () => {
    expect(isInputModeCharacter('!')).toBe(true)
  })

  test('!ls → false (not exact)', () => {
    expect(isInputModeCharacter('!ls')).toBe(false)
  })

  test('empty string → false', () => {
    expect(isInputModeCharacter('')).toBe(false)
  })

  test('whitespace → false', () => {
    expect(isInputModeCharacter(' ')).toBe(false)
  })

  test('?  → false (not the bash-mode marker)', () => {
    expect(isInputModeCharacter('?')).toBe(false)
  })
})

describe('round-trip: prepend → getValue', () => {
  test('bash mode round-trips', () => {
    const original = 'ls -la /tmp'
    const prepended = prependModeCharacterToInput(original, 'bash' as never)
    expect(getValueFromInput(prepended)).toBe(original)
    expect(getModeFromInput(prepended)).toBe('bash')
  })

  test('prompt mode round-trips', () => {
    const original = 'hello world'
    const prepended = prependModeCharacterToInput(original, 'prompt' as never)
    expect(getValueFromInput(prepended)).toBe(original)
    expect(getModeFromInput(prepended)).toBe('prompt')
  })
})
