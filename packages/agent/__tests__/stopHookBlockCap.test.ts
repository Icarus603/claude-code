/**
 * Contract test for the consecutive Stop-hook block cap — ant v2.1.143
 * 3999.js. Locks resolveStopHookBlockCap (env parse) and
 * evaluateStopHookBlockOutcome (the decision arithmetic the query loop runs
 * after every blocking Stop hook).
 *
 * Why this exists: a `/goal` Stop hook whose condition can never be satisfied
 * blocks the turn from ending every cycle, injecting a blockingError into the
 * transcript each time. Left unbounded the transcript grows until the main
 * API call 413s ("Prompt is too long"). This cap is the structural backstop;
 * the `impossible` evaluator verdict (execPromptHook) can short-circuit *some*
 * cases but relies on the evaluator volunteering "impossible", so it can't be
 * the guarantee.
 *
 * A drift here either removes the backstop (PTL death-spiral returns) or caps
 * too aggressively (kills legitimate long-running /goal loops). The
 * max_turns bound matters too: without it a blocking hook re-queries forever
 * in headless mode regardless of --max-turns.
 */
import { describe, expect, test } from 'bun:test'
import {
  evaluateStopHookBlockOutcome,
  resolveStopHookBlockCap,
} from '../internal/stopHooksCore.js'

describe('resolveStopHookBlockCap', () => {
  test('unset / empty / non-numeric → default 8', () => {
    expect(resolveStopHookBlockCap(undefined)).toBe(8)
    expect(resolveStopHookBlockCap('')).toBe(8)
    expect(resolveStopHookBlockCap('abc')).toBe(8)
    expect(resolveStopHookBlockCap('  ')).toBe(8)
  })

  test('positive integer → that value', () => {
    expect(resolveStopHookBlockCap('1')).toBe(1)
    expect(resolveStopHookBlockCap('16')).toBe(16)
  })

  test('zero / negative → passed through (caller >0 guard disables cap)', () => {
    expect(resolveStopHookBlockCap('0')).toBe(0)
    expect(resolveStopHookBlockCap('-1')).toBe(-1)
  })

  test('radix-10 parseInt semantics match ant', () => {
    expect(resolveStopHookBlockCap('8abc')).toBe(8) // leading digits
    expect(resolveStopHookBlockCap('0x10')).toBe(0) // stops at x
  })
})

describe('evaluateStopHookBlockOutcome', () => {
  test('under the cap → continue with bumped counters', () => {
    const d = evaluateStopHookBlockOutcome({
      turnCount: 3,
      blockingCount: 2,
      maxTurns: undefined,
      blockCapEnv: undefined,
    })
    expect(d).toEqual({
      kind: 'continue',
      nextTurnCount: 4,
      nextBlockingCount: 3,
    })
  })

  test('8th consecutive block still continues (default cap 8)', () => {
    const d = evaluateStopHookBlockOutcome({
      turnCount: 7,
      blockingCount: 7, // → nextBlockingCount 8, not > 8
      maxTurns: undefined,
      blockCapEnv: undefined,
    })
    expect(d.kind).toBe('continue')
  })

  test('9th consecutive block trips the cap (default 8)', () => {
    const d = evaluateStopHookBlockOutcome({
      turnCount: 8,
      blockingCount: 8, // → nextBlockingCount 9 > 8
      maxTurns: undefined,
      blockCapEnv: undefined,
    })
    expect(d).toEqual({ kind: 'cap_exceeded', nextBlockingCount: 9 })
  })

  test('custom cap via env honoured', () => {
    const d = evaluateStopHookBlockOutcome({
      turnCount: 2,
      blockingCount: 2, // → 3 > 2
      maxTurns: undefined,
      blockCapEnv: '2',
    })
    expect(d).toEqual({ kind: 'cap_exceeded', nextBlockingCount: 3 })
  })

  test('cap=0 disables the backstop — never trips no matter the streak', () => {
    const d = evaluateStopHookBlockOutcome({
      turnCount: 999,
      blockingCount: 999,
      maxTurns: undefined,
      blockCapEnv: '0',
    })
    expect(d.kind).toBe('continue')
    expect(d.nextBlockingCount).toBe(1000)
  })

  test('maxTurns trips before the cap and takes precedence', () => {
    // Even with cap disabled, maxTurns still bounds the blocking loop.
    const d = evaluateStopHookBlockOutcome({
      turnCount: 5,
      blockingCount: 0,
      maxTurns: 5, // nextTurnCount 6 > 5
      blockCapEnv: '0',
    })
    expect(d).toEqual({
      kind: 'max_turns',
      nextTurnCount: 6,
      nextBlockingCount: 1,
    })
  })

  test('maxTurns checked against nextTurnCount, not current', () => {
    // turnCount 4, maxTurns 5 → nextTurnCount 5, not > 5 → still continue.
    const d = evaluateStopHookBlockOutcome({
      turnCount: 4,
      blockingCount: 0,
      maxTurns: 5,
      blockCapEnv: undefined,
    })
    expect(d.kind).toBe('continue')
    expect(d.nextTurnCount).toBe(5)
  })

  test('max_turns wins when both maxTurns and cap would trip', () => {
    // ant order: maxTurns check precedes the cap check.
    const d = evaluateStopHookBlockOutcome({
      turnCount: 10,
      blockingCount: 20, // cap would trip (21 > 8)
      maxTurns: 5, // but maxTurns trips first (11 > 5)
      blockCapEnv: undefined,
    })
    expect(d.kind).toBe('max_turns')
  })
})
