import { describe, expect, test } from 'bun:test'
import { extractTeammateOptions } from '../options.js'

describe('extractTeammateOptions — defensive parsing', () => {
  test('null → empty object', () => {
    expect(extractTeammateOptions(null)).toEqual({})
  })

  test('undefined → empty object', () => {
    expect(extractTeammateOptions(undefined)).toEqual({})
  })

  test('non-object primitives → empty object', () => {
    expect(extractTeammateOptions('string')).toEqual({})
    expect(extractTeammateOptions(42)).toEqual({})
    expect(extractTeammateOptions(true)).toEqual({})
  })

  test('array also accepted as object (typeof [] === "object")', () => {
    // typeof [] is 'object', so the function does NOT reject arrays.
    // Array indices spelled as numbers are not accessed via the field
    // names, so the result is empty (no agentId etc. fields).
    expect(extractTeammateOptions([])).toEqual({
      agentId: undefined,
      agentName: undefined,
      teamName: undefined,
      agentColor: undefined,
      planModeRequired: undefined,
      parentSessionId: undefined,
      teammateMode: undefined,
      agentType: undefined,
    })
  })
})

describe('extractTeammateOptions — string fields', () => {
  test('all 5 string fields propagate when provided', () => {
    expect(
      extractTeammateOptions({
        agentId: 'agent-1',
        agentName: 'researcher',
        teamName: 'my-team',
        agentColor: 'blue',
        parentSessionId: 'sess-abc',
        agentType: 'custom',
      }),
    ).toEqual({
      agentId: 'agent-1',
      agentName: 'researcher',
      teamName: 'my-team',
      agentColor: 'blue',
      planModeRequired: undefined,
      parentSessionId: 'sess-abc',
      teammateMode: undefined,
      agentType: 'custom',
    })
  })

  test('non-string string-fields are dropped to undefined', () => {
    // CRITICAL: numeric or boolean values for string fields must NOT
    // propagate. A future refactor that uses `String(opts.agentId)`
    // would silently let `42` become `"42"` — which would route to a
    // nonexistent agent ID. The strict typeof check is load-bearing.
    expect(
      extractTeammateOptions({
        agentId: 42,
        agentName: true,
        teamName: null,
      }),
    ).toEqual({
      agentId: undefined,
      agentName: undefined,
      teamName: undefined,
      agentColor: undefined,
      planModeRequired: undefined,
      parentSessionId: undefined,
      teammateMode: undefined,
      agentType: undefined,
    })
  })

  test('empty string IS accepted (truthy check uses typeof, not Boolean)', () => {
    // The check is `typeof opts.X === 'string'`, NOT `opts.X` (truthy).
    // Empty string is a valid string. Documents this — if the caller
    // passes '', that propagates as ''.
    expect(
      extractTeammateOptions({
        agentId: '',
      }).agentId,
    ).toBe('')
  })
})

describe('extractTeammateOptions — planModeRequired (boolean)', () => {
  test('true → true', () => {
    expect(
      extractTeammateOptions({ planModeRequired: true }).planModeRequired,
    ).toBe(true)
  })

  test('false → false (not undefined!)', () => {
    // CRITICAL: false is a valid value, not "missing". The check is
    // `typeof === 'boolean'`. A future `opts.planModeRequired ?? undefined`
    // refactor would convert false to undefined and break the
    // explicit-no-plan-mode contract.
    expect(
      extractTeammateOptions({ planModeRequired: false }).planModeRequired,
    ).toBe(false)
  })

  test('non-boolean rejected (string "true" → undefined)', () => {
    expect(
      extractTeammateOptions({ planModeRequired: 'true' }).planModeRequired,
    ).toBeUndefined()
  })

  test('non-boolean rejected (number 1 → undefined)', () => {
    expect(
      extractTeammateOptions({ planModeRequired: 1 }).planModeRequired,
    ).toBeUndefined()
  })
})

describe('extractTeammateOptions — teammateMode enum', () => {
  // The teammateMode field must be one of three exact values; anything
  // else is dropped to undefined. This is a security boundary — if a
  // user could pass an arbitrary mode string, the runtime might crash
  // with an unhandled mode case in the dispatcher.

  test('"auto" → "auto"', () => {
    expect(
      extractTeammateOptions({ teammateMode: 'auto' }).teammateMode,
    ).toBe('auto')
  })

  test('"tmux" → "tmux"', () => {
    expect(
      extractTeammateOptions({ teammateMode: 'tmux' }).teammateMode,
    ).toBe('tmux')
  })

  test('"in-process" → "in-process"', () => {
    expect(
      extractTeammateOptions({ teammateMode: 'in-process' }).teammateMode,
    ).toBe('in-process')
  })

  test('unknown mode → undefined', () => {
    expect(
      extractTeammateOptions({ teammateMode: 'foreground' }).teammateMode,
    ).toBeUndefined()
  })

  test('case mismatch ("AUTO") → undefined', () => {
    // Case-sensitive enum check. Documents this — typo'd uppercase
    // doesn't match.
    expect(
      extractTeammateOptions({ teammateMode: 'AUTO' }).teammateMode,
    ).toBeUndefined()
  })

  test('non-string mode → undefined', () => {
    expect(
      extractTeammateOptions({ teammateMode: 42 }).teammateMode,
    ).toBeUndefined()
  })

  test('null mode → undefined', () => {
    expect(
      extractTeammateOptions({ teammateMode: null }).teammateMode,
    ).toBeUndefined()
  })
})

describe('extractTeammateOptions — extra fields silently dropped', () => {
  test('unknown fields do not leak into output', () => {
    // The function only forwards the 8 known fields. Extra fields in
    // the input are silently dropped — defensive against typo'd
    // CLI arg names or stale callers.
    const result = extractTeammateOptions({
      agentId: 'a',
      randomExtraField: 'leaked?',
      anotherNoise: 42,
    })
    expect(result).toEqual({
      agentId: 'a',
      agentName: undefined,
      teamName: undefined,
      agentColor: undefined,
      planModeRequired: undefined,
      parentSessionId: undefined,
      teammateMode: undefined,
      agentType: undefined,
    })
    expect((result as Record<string, unknown>).randomExtraField).toBeUndefined()
  })
})
