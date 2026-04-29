/**
 * Tests for hook type guards — drive sync/async hook dispatch routing.
 *
 * Wrong classification = either:
 *   - Async hook treated as sync: caller waits for a result that
 *     never arrives synchronously, hangs the turn
 *   - Sync hook treated as async: caller assumes future-based, but
 *     it returned immediately, output dropped
 *
 * isHookEvent guards the API surface — accepting an unknown string
 * as a HookEvent name lets configuration silently drift.
 */
import { describe, expect, test } from 'bun:test'
import {
  isAsyncHookJSONOutput,
  isHookEvent,
  isSyncHookJSONOutput,
} from '../types/hooks.js'
import type { HookJSONOutput } from '@claude-code/headless-sdk/agentSdkTypes.js'

describe('isHookEvent — type guard for HookEvent string union', () => {
  test('known events accepted', () => {
    expect(isHookEvent('PreToolUse')).toBe(true)
    expect(isHookEvent('PostToolUse')).toBe(true)
    expect(isHookEvent('Stop')).toBe(true)
    expect(isHookEvent('SessionStart')).toBe(true)
    expect(isHookEvent('Notification')).toBe(true)
  })

  test('unknown event names rejected', () => {
    expect(isHookEvent('SomeFutureEvent')).toBe(false)
    expect(isHookEvent('preToolUse')).toBe(false) // case-sensitive
    expect(isHookEvent('PRE_TOOL_USE')).toBe(false) // upper-snake
    expect(isHookEvent('')).toBe(false)
  })

  test('typo-like names rejected', () => {
    // Catch common typos that would have silently disabled hooks.
    expect(isHookEvent('PreTooluse')).toBe(false) // wrong case
    expect(isHookEvent('PreToolUsage')).toBe(false)
    expect(isHookEvent('PostUseTool')).toBe(false)
  })
})

describe('isSyncHookJSONOutput — discriminated union guard', () => {
  test('object without async key → sync (true)', () => {
    expect(isSyncHookJSONOutput({} as HookJSONOutput)).toBe(true)
  })

  test('object with async: false → sync (true)', () => {
    expect(
      isSyncHookJSONOutput({ async: false } as unknown as HookJSONOutput),
    ).toBe(true)
  })

  test('object with async: true → NOT sync', () => {
    expect(
      isSyncHookJSONOutput({ async: true } as unknown as HookJSONOutput),
    ).toBe(false)
  })

  test('object with async: undefined → sync (no async key after delete)', () => {
    // Documented: only async===true rejects. Falsy values are sync.
    expect(
      isSyncHookJSONOutput({ async: undefined } as unknown as HookJSONOutput),
    ).toBe(true)
  })

  test('object with continue/decision (sync field) → sync', () => {
    expect(
      isSyncHookJSONOutput({
        continue: true,
        decision: 'approve',
      } as HookJSONOutput),
    ).toBe(true)
  })

  test('object with async: 1 (truthy non-bool) → STILL sync (strict ===)', () => {
    // Documented: only EXACTLY async===true triggers async classification.
    expect(
      isSyncHookJSONOutput({ async: 1 } as unknown as HookJSONOutput),
    ).toBe(true)
  })
})

describe('isAsyncHookJSONOutput — inverse guard', () => {
  test('async: true → async (true)', () => {
    expect(
      isAsyncHookJSONOutput({ async: true } as unknown as HookJSONOutput),
    ).toBe(true)
  })

  test('async: false → NOT async', () => {
    expect(
      isAsyncHookJSONOutput({ async: false } as unknown as HookJSONOutput),
    ).toBe(false)
  })

  test('object without async key → NOT async', () => {
    expect(isAsyncHookJSONOutput({} as HookJSONOutput)).toBe(false)
  })

  test('async: 1 (truthy) → NOT async (strict ===)', () => {
    expect(
      isAsyncHookJSONOutput({ async: 1 } as unknown as HookJSONOutput),
    ).toBe(false)
  })

  test('async: "true" (string) → NOT async', () => {
    expect(
      isAsyncHookJSONOutput({ async: 'true' } as unknown as HookJSONOutput),
    ).toBe(false)
  })
})

describe('isSyncHookJSONOutput / isAsyncHookJSONOutput — exhaustive partition', () => {
  test('every input is exactly one of sync OR async (mutually exclusive)', () => {
    const cases = [
      {} as HookJSONOutput,
      { async: false } as unknown as HookJSONOutput,
      { async: true } as unknown as HookJSONOutput,
      { continue: true } as HookJSONOutput,
      { decision: 'approve' } as HookJSONOutput,
      { async: undefined } as unknown as HookJSONOutput,
    ]
    for (const c of cases) {
      const sync = isSyncHookJSONOutput(c)
      const async = isAsyncHookJSONOutput(c)
      // XOR: exactly one of them is true.
      expect(sync !== async).toBe(true)
    }
  })
})
