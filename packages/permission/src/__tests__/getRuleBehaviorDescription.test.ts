import { describe, expect, test } from 'bun:test'
import { getRuleBehaviorDescription } from '../PermissionResult.js'

describe('getRuleBehaviorDescription', () => {
  // Used in user-facing permission dialogs and event log messages.
  // Critical that the past-tense verb matches the behavior — wrong
  // wording (e.g., "allowed" for a deny) silently mis-reports security
  // state to the user.

  test('"allow" → "allowed"', () => {
    expect(getRuleBehaviorDescription('allow')).toBe('allowed')
  })

  test('"deny" → "denied"', () => {
    expect(getRuleBehaviorDescription('deny')).toBe('denied')
  })

  test('"ask" → "asked for confirmation for"', () => {
    expect(getRuleBehaviorDescription('ask')).toBe('asked for confirmation for')
  })

  test('any other value (default branch) → "asked for confirmation for"', () => {
    // Default is the "ask" wording — fail-safe: if a new behavior
    // type is added without updating this function, it falls into
    // "ask" rather than "allow".
    expect(
      getRuleBehaviorDescription('passthrough' as never),
    ).toBe('asked for confirmation for')
    expect(
      getRuleBehaviorDescription('something_else' as never),
    ).toBe('asked for confirmation for')
  })

  test('returns lowercase always (no toLowerCase needed by callers)', () => {
    expect(getRuleBehaviorDescription('allow')).toBe(
      'allowed'.toLowerCase(),
    )
    expect(getRuleBehaviorDescription('deny')).toBe('denied'.toLowerCase())
  })
})
