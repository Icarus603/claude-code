import { describe, expect, test } from 'bun:test'
import {
  getCommandName,
  isCommandEnabled,
  type CommandBase,
} from '../types.js'

function makeCmd(over: Partial<CommandBase> = {}): CommandBase {
  return {
    name: 'default-name',
    description: 'desc',
    ...over,
  }
}

describe('getCommandName — userFacingName precedence', () => {
  test('returns userFacingName() result when defined', () => {
    expect(
      getCommandName(makeCmd({ userFacingName: () => 'fancy-name' })),
    ).toBe('fancy-name')
  })

  test('falls back to .name when userFacingName is undefined', () => {
    expect(getCommandName(makeCmd({ name: 'plain-name' }))).toBe('plain-name')
  })

  test('userFacingName returning empty string still wins (truthy check NOT done)', () => {
    // The function uses ?? not ||. Empty string is non-nullish → wins.
    // CRITICAL: a refactor to || would silently swap to .name fallback.
    expect(
      getCommandName(
        makeCmd({ name: 'plain-name', userFacingName: () => '' }),
      ),
    ).toBe('')
  })

  test('userFacingName called fresh each invocation (not cached)', () => {
    let calls = 0
    const cmd = makeCmd({
      userFacingName: () => `name-${calls++}`,
    })
    expect(getCommandName(cmd)).toBe('name-0')
    expect(getCommandName(cmd)).toBe('name-1')
  })
})

describe('isCommandEnabled — isEnabled precedence', () => {
  test('returns isEnabled() result when defined and true', () => {
    expect(isCommandEnabled(makeCmd({ isEnabled: () => true }))).toBe(true)
  })

  test('returns false when isEnabled() returns false', () => {
    expect(isCommandEnabled(makeCmd({ isEnabled: () => false }))).toBe(false)
  })

  test('defaults to TRUE when isEnabled is undefined', () => {
    // Critical default — commands without an explicit gate are
    // enabled by default. A future ?? false would silently disable
    // every command lacking an isEnabled.
    expect(isCommandEnabled(makeCmd())).toBe(true)
  })

  test('isEnabled() called fresh each invocation', () => {
    // The gate may depend on dynamic state (env, settings). Document
    // that it's not memoized.
    let calls = 0
    const cmd = makeCmd({ isEnabled: () => calls++ === 0 })
    expect(isCommandEnabled(cmd)).toBe(true) // calls=0, ret true
    expect(isCommandEnabled(cmd)).toBe(false) // calls=1, ret false
  })
})
