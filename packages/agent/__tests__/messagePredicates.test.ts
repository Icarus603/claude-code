import { describe, expect, test } from 'bun:test'
import { isHumanTurn } from '../messagePredicates.js'

type Msg = Parameters<typeof isHumanTurn>[0]

describe('isHumanTurn', () => {
  // Critical contract: tool_result messages share `type: 'user'` with
  // human turns. The discriminant is the absence of `toolUseResult` AND
  // not being marked `isMeta`. If a future refactor inverts this logic
  // (e.g., uses `toolUseResult !== null` instead of `=== undefined`),
  // tool_result messages would be counted as user prompts in attribution
  // / token-budget / transcript replay paths.

  test('returns true for plain user message', () => {
    expect(
      isHumanTurn({ type: 'user', message: { content: 'hi' } } as Msg),
    ).toBe(true)
  })

  test('returns false for assistant message', () => {
    expect(isHumanTurn({ type: 'assistant' } as never)).toBe(false)
  })

  test('returns false for system message', () => {
    expect(isHumanTurn({ type: 'system' } as never)).toBe(false)
  })

  test('returns false when toolUseResult is set (tool result message)', () => {
    expect(
      isHumanTurn({
        type: 'user',
        toolUseResult: { stdout: 'output' },
        message: { content: 'r' },
      } as Msg),
    ).toBe(false)
  })

  test('returns false when toolUseResult is null', () => {
    // `=== undefined` excludes null. Catches the silent-bug shape where
    // a refactor uses `!toolUseResult` (which would treat null as
    // human-turn since `!null === true`).
    expect(
      isHumanTurn({
        type: 'user',
        toolUseResult: null,
        message: { content: 'r' },
      } as never),
    ).toBe(false)
  })

  test('returns false when toolUseResult is empty object {}', () => {
    // {} is a valid toolUseResult value (e.g., a tool that returns
    // void). It must NOT be treated as missing.
    expect(
      isHumanTurn({
        type: 'user',
        toolUseResult: {},
        message: { content: 'r' },
      } as Msg),
    ).toBe(false)
  })

  test('returns false when isMeta is true', () => {
    expect(
      isHumanTurn({
        type: 'user',
        isMeta: true,
        message: { content: 'meta' },
      } as Msg),
    ).toBe(false)
  })

  test('returns true when isMeta is undefined (typical case)', () => {
    expect(isHumanTurn({ type: 'user', message: { content: 'hi' } } as Msg)).toBe(
      true,
    )
  })

  test('returns true when isMeta is false (explicit false)', () => {
    expect(
      isHumanTurn({
        type: 'user',
        isMeta: false,
        message: { content: 'hi' },
      } as Msg),
    ).toBe(true)
  })

  test('type narrowing — returned-true narrows to UserMessage', () => {
    const m: Msg = { type: 'user', message: { content: 'hi' } } as Msg
    if (isHumanTurn(m)) {
      // After type guard, m is UserMessage. Compile-time check.
      const x: { type: 'user' } = m
      expect(x.type).toBe('user')
    }
  })
})
