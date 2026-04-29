/**
 * Tests for joinPromptValues + canBatchWith — drive the SDK's queued-
 * command batching. Wrong batching = unrelated user prompts merge,
 * wrong attribution = workload tag lost, isMeta flag dropped.
 */
import { describe, expect, test } from 'bun:test'
import {
  canBatchWith,
  joinPromptValues,
} from '../headless/sdk/session/prompt-utils.js'
import type { QueuedCommand } from '@claude-code/repl/textInputTypes.js'

describe('joinPromptValues — single value passthrough', () => {
  test('single string returns the string', () => {
    expect(joinPromptValues(['hello'])).toBe('hello')
  })

  test('single block array returns the array', () => {
    const blocks = [{ type: 'text', text: 'a' }] as never[]
    expect(joinPromptValues([blocks])).toBe(blocks)
  })
})

describe('joinPromptValues — multi-value joining', () => {
  test('all strings: newline-joined', () => {
    expect(joinPromptValues(['a', 'b', 'c'])).toBe('a\nb\nc')
  })

  test('mixed string + block: all normalized to blocks', () => {
    const result = joinPromptValues([
      'first',
      [{ type: 'text', text: 'second' }] as never,
    ])
    expect(Array.isArray(result)).toBe(true)
    const blocks = result as Array<{ type: string; text?: string }>
    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.type).toBe('text')
    expect(blocks[0]?.text).toBe('first')
    expect(blocks[1]?.text).toBe('second')
  })

  test('multiple block arrays flattened', () => {
    const result = joinPromptValues([
      [{ type: 'text', text: 'a' }] as never,
      [{ type: 'text', text: 'b' }, { type: 'text', text: 'c' }] as never,
    ])
    expect(result).toHaveLength(3)
  })

  test('empty values array stays empty (single-element fast path doesn\'t fire)', () => {
    // joinPromptValues([]) → length !== 1 → falls through to all-strings
    // check (every() on empty = true) → joins empty array with '\n' = ''
    expect(joinPromptValues([])).toBe('')
  })
})

function cmd(over: Partial<QueuedCommand> = {}): QueuedCommand {
  return {
    mode: 'prompt',
    workload: 'main' as never,
    isMeta: false,
    value: 'x',
    ...over,
  } as QueuedCommand
}

describe('canBatchWith — basic gating', () => {
  test('matching prompts can batch', () => {
    expect(canBatchWith(cmd(), cmd())).toBe(true)
  })

  test('next undefined → cannot batch', () => {
    expect(canBatchWith(cmd(), undefined)).toBe(false)
  })

  test('next mode bash → cannot batch', () => {
    expect(canBatchWith(cmd(), cmd({ mode: 'bash' as never }))).toBe(false)
  })

  test('next mode task-notification → cannot batch (only prompt mode batches)', () => {
    expect(
      canBatchWith(cmd(), cmd({ mode: 'task-notification' as never })),
    ).toBe(false)
  })
})

describe('canBatchWith — workload tag', () => {
  test('matching workload tags batch', () => {
    expect(
      canBatchWith(
        cmd({ workload: 'review' as never }),
        cmd({ workload: 'review' as never }),
      ),
    ).toBe(true)
  })

  test('different workload tags do NOT batch', () => {
    // Documented: prevents attribution leakage across turns.
    expect(
      canBatchWith(
        cmd({ workload: 'review' as never }),
        cmd({ workload: 'main' as never }),
      ),
    ).toBe(false)
  })
})

describe('canBatchWith — isMeta flag', () => {
  test('both isMeta=false → batch', () => {
    expect(canBatchWith(cmd({ isMeta: false }), cmd({ isMeta: false }))).toBe(
      true,
    )
  })

  test('both isMeta=true → batch', () => {
    expect(canBatchWith(cmd({ isMeta: true }), cmd({ isMeta: true }))).toBe(
      true,
    )
  })

  test('isMeta mismatch → cannot batch (locks proactive-tick non-merge)', () => {
    // Documented: proactive tick can't merge into user prompt and lose
    // its hidden-in-transcript marking.
    expect(canBatchWith(cmd({ isMeta: true }), cmd({ isMeta: false }))).toBe(
      false,
    )
    expect(canBatchWith(cmd({ isMeta: false }), cmd({ isMeta: true }))).toBe(
      false,
    )
  })
})
