import { describe, expect, test } from 'bun:test'
import {
  countToolCalls,
  SYNTHETIC_MESSAGES,
} from '../internal/messageHelpers.js'

type Msg = Parameters<typeof countToolCalls>[0][number]

describe('SYNTHETIC_MESSAGES — known synthetic strings', () => {
  // These strings are used elsewhere as anchors to detect injected
  // synthetic user messages (e.g., transcript filtering, attribution
  // counting). If a future change adds a new synthetic message but
  // forgets to update this set, the message would be counted as a
  // real user prompt — silently inflating prompt counts.

  test('contains "[Request interrupted by user]"', () => {
    expect(SYNTHETIC_MESSAGES.has('[Request interrupted by user]')).toBe(true)
  })
  test('contains "[Request interrupted by user for tool use]"', () => {
    expect(
      SYNTHETIC_MESSAGES.has('[Request interrupted by user for tool use]'),
    ).toBe(true)
  })
  test('contains "No response requested."', () => {
    expect(SYNTHETIC_MESSAGES.has('No response requested.')).toBe(true)
  })
  test('contains the "doesn\'t want to take this action" rejection', () => {
    const rejection = SYNTHETIC_MESSAGES.values()
    let found = false
    for (const m of rejection) {
      if (m.includes("doesn't want to take this action")) found = true
    }
    expect(found).toBe(true)
  })
  test('contains the "doesn\'t want to proceed with this tool" rejection', () => {
    let found = false
    for (const m of SYNTHETIC_MESSAGES) {
      if (m.includes("doesn't want to proceed with this tool")) found = true
    }
    expect(found).toBe(true)
  })

  test('does NOT contain user-typed messages (e.g., "hi")', () => {
    expect(SYNTHETIC_MESSAGES.has('hi')).toBe(false)
    expect(SYNTHETIC_MESSAGES.has('hello')).toBe(false)
    expect(SYNTHETIC_MESSAGES.has('')).toBe(false)
  })
})

describe('countToolCalls — empty / no-match cases', () => {
  test('returns 0 for empty messages', () => {
    expect(countToolCalls([], 'Bash')).toBe(0)
  })

  test('returns 0 when no assistant messages', () => {
    expect(
      countToolCalls(
        [{ type: 'user', message: { content: [] } } as never],
        'Bash',
      ),
    ).toBe(0)
  })

  test('returns 0 when no message uses the requested tool', () => {
    const messages: Msg[] = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'x', name: 'Edit', input: {} }],
        },
      } as never,
    ]
    expect(countToolCalls(messages, 'Bash')).toBe(0)
  })

  test('skips falsy messages (null/undefined)', () => {
    const messages = [null, undefined, null] as never as Msg[]
    expect(countToolCalls(messages, 'Bash')).toBe(0)
  })
})

describe('countToolCalls — basic counting', () => {
  test('counts a single tool_use', () => {
    const messages: Msg[] = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }],
        },
      } as never,
    ]
    expect(countToolCalls(messages, 'Bash')).toBe(1)
  })

  test('counts each ASSISTANT message that uses the tool, not each tool_use block', () => {
    // Contract: function counts MESSAGES that contain ≥1 matching
    // tool_use, NOT individual tool_use blocks. Two tool_uses in the
    // same message = 1 count.
    const messages: Msg[] = [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'x', name: 'Bash', input: {} },
            { type: 'tool_use', id: 'y', name: 'Bash', input: {} },
          ],
        },
      } as never,
    ]
    expect(countToolCalls(messages, 'Bash')).toBe(1)
  })

  test('counts across multiple assistant messages', () => {
    const messages: Msg[] = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: {} }],
        },
      } as never,
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'b', name: 'Bash', input: {} }],
        },
      } as never,
    ]
    expect(countToolCalls(messages, 'Bash')).toBe(2)
  })

  test('does NOT count user/system messages', () => {
    const messages: Msg[] = [
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }],
        },
      } as never,
    ]
    expect(countToolCalls(messages, 'Bash')).toBe(0)
  })

  test('does NOT count when assistant content is non-array', () => {
    const messages: Msg[] = [
      { type: 'assistant', message: { content: 'plain string' } } as never,
    ]
    expect(countToolCalls(messages, 'Bash')).toBe(0)
  })

  test('counts only matching tool name (case-sensitive)', () => {
    const messages: Msg[] = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'x', name: 'bash', input: {} }],
        },
      } as never,
    ]
    expect(countToolCalls(messages, 'Bash')).toBe(0)
    expect(countToolCalls(messages, 'bash')).toBe(1)
  })
})

describe('countToolCalls — early-exit via maxCount', () => {
  // Critical contract: maxCount lets callers stop iterating once
  // they've seen "enough" — used by hot-path checks where we just
  // need "≥N" not the precise count.

  test('returns immediately when count reaches maxCount', () => {
    const messages: Msg[] = Array.from({ length: 10 }, (_, i) => ({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: `tu_${i}`, name: 'Bash', input: {} },
        ],
      },
    })) as never
    expect(countToolCalls(messages, 'Bash', 3)).toBe(3)
  })

  test('does NOT exit early when count is below maxCount', () => {
    const messages: Msg[] = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }],
        },
      } as never,
    ]
    expect(countToolCalls(messages, 'Bash', 5)).toBe(1)
  })

  test('returns full count when maxCount is undefined', () => {
    const messages: Msg[] = Array.from({ length: 5 }, (_, i) => ({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: `tu_${i}`, name: 'Bash', input: {} },
        ],
      },
    })) as never
    expect(countToolCalls(messages, 'Bash')).toBe(5)
  })

  test('maxCount=0 is falsy and effectively disables early-exit', () => {
    // Contract: `maxCount && count >= maxCount` short-circuits when
    // maxCount=0 because 0 is falsy. So passing 0 acts like "no cap".
    // This documents that quirk — passing 0 doesn't return 0.
    const messages: Msg[] = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }],
        },
      } as never,
    ]
    expect(countToolCalls(messages, 'Bash', 0)).toBe(1)
  })
})
