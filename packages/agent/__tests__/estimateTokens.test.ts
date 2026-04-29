import { describe, expect, test } from 'bun:test'
import { estimateMessageTokens } from '../compaction/estimateTokens.js'

const deps = {
  // 1 token per char (deterministic for tests).
  roughEstimate: (text: string) => text.length,
  jsonStringify: (v: unknown) => JSON.stringify(v),
}

type Msg = Parameters<typeof estimateMessageTokens>[0][number]

describe('estimateMessageTokens — basic', () => {
  test('empty input → 0', () => {
    expect(estimateMessageTokens([], deps)).toBe(0)
  })

  test('skips messages with type other than user/assistant', () => {
    const msgs: Msg[] = [
      { type: 'system', message: { content: [{ type: 'text', text: 'sys' }] } },
      { type: 'progress', message: { content: [{ type: 'text', text: 'p' }] } },
    ]
    expect(estimateMessageTokens(msgs, deps)).toBe(0)
  })

  test('user text block → roughEstimate(text) * 4/3 ceil', () => {
    const msgs: Msg[] = [
      { type: 'user', message: { content: [{ type: 'text', text: 'abc' }] } },
    ]
    // 3 chars * (4/3) = 4.
    expect(estimateMessageTokens(msgs, deps)).toBe(4)
  })

  test('assistant text block also counted', () => {
    const msgs: Msg[] = [
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello world' }] },
      },
    ]
    // 11 chars * 4/3 = 14.66 → ceil = 15.
    expect(estimateMessageTokens(msgs, deps)).toBe(15)
  })
})

describe('estimateMessageTokens — block types', () => {
  test('image block → fixed 2000 tokens', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        message: {
          content: [{ type: 'image', source: { type: 'base64', data: 'x' } }],
        },
      },
    ]
    // 2000 * 4/3 = 2666.66 → 2667.
    expect(estimateMessageTokens(msgs, deps)).toBe(2667)
  })

  test('document block → also 2000 tokens', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        message: { content: [{ type: 'document', source: {} }] },
      },
    ]
    expect(estimateMessageTokens(msgs, deps)).toBe(2667)
  })

  test('thinking block → roughEstimate(thinking) counted', () => {
    const msgs: Msg[] = [
      {
        type: 'assistant',
        message: { content: [{ type: 'thinking', thinking: 'abcdef' }] },
      },
    ]
    // 6 * 4/3 = 8.
    expect(estimateMessageTokens(msgs, deps)).toBe(8)
  })

  test('redacted_thinking block → roughEstimate(data) counted', () => {
    const msgs: Msg[] = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'redacted_thinking', data: 'redacted-data' }],
        },
      },
    ]
    expect(estimateMessageTokens(msgs, deps)).toBe(Math.ceil(13 * (4 / 3)))
  })

  test('tool_use → name + JSON-stringified input', () => {
    const msgs: Msg[] = [
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'Bash',
              input: { cmd: 'ls' },
            },
          ],
        },
      },
    ]
    // 'Bash' + JSON.stringify({cmd:'ls'}) = 'Bash' + '{"cmd":"ls"}' = 4 + 12 = 16.
    expect(estimateMessageTokens(msgs, deps)).toBe(Math.ceil(16 * (4 / 3)))
  })

  test('tool_use with missing input defaults to {} for stringify', () => {
    // `block.input ?? {}` — undefined input falls back to empty object.
    const msgs: Msg[] = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't', name: 'Bash' }],
        },
      },
    ]
    // 'Bash' + '{}' = 6.
    expect(estimateMessageTokens(msgs, deps)).toBe(Math.ceil(6 * (4 / 3)))
  })

  test('unknown block type falls through to JSON.stringify(block)', () => {
    const msgs: Msg[] = [
      {
        type: 'assistant',
        message: { content: [{ type: 'unknown_type', payload: 'x' }] },
      },
    ]
    // JSON.stringify({type:'unknown_type',payload:'x'}) = ~30 chars.
    const result = estimateMessageTokens(msgs, deps)
    expect(result).toBeGreaterThan(0)
  })
})

describe('estimateMessageTokens — tool_result blocks', () => {
  test('string content → roughEstimate(content)', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't', content: 'output' },
          ],
        },
      },
    ]
    expect(estimateMessageTokens(msgs, deps)).toBe(Math.ceil(6 * (4 / 3)))
  })

  test('array content with text blocks summed', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't',
              content: [
                { type: 'text', text: 'abc' },
                { type: 'text', text: 'defg' },
              ],
            },
          ],
        },
      },
    ]
    // 3 + 4 = 7 chars.
    expect(estimateMessageTokens(msgs, deps)).toBe(Math.ceil(7 * (4 / 3)))
  })

  test('array with image inside tool_result counts as 2000', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't',
              content: [
                { type: 'text', text: 'hi' },
                { type: 'image', source: {} },
              ],
            },
          ],
        },
      },
    ]
    // 2 + 2000 = 2002 → * 4/3 → 2670.
    expect(estimateMessageTokens(msgs, deps)).toBe(Math.ceil(2002 * (4 / 3)))
  })

  test('missing content → 0', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't' }] },
      },
    ]
    expect(estimateMessageTokens(msgs, deps)).toBe(0)
  })

  test('non-array, non-string content → 0', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't', content: { complex: 'obj' } },
          ],
        },
      },
    ]
    expect(estimateMessageTokens(msgs, deps)).toBe(0)
  })
})

describe('estimateMessageTokens — final ceiling', () => {
  // The function multiplies by 4/3 and ceil's. Chars-to-tokens estimate:
  // 4/3 ratio (rough Anthropic guidance). Verify the ceiling logic.

  test('1 char × 4/3 = 1.33 → ceil → 2', () => {
    const msgs: Msg[] = [
      { type: 'user', message: { content: [{ type: 'text', text: 'x' }] } },
    ]
    expect(estimateMessageTokens(msgs, deps)).toBe(2)
  })

  test('3 chars × 4/3 = 4.0 → ceil = 4 (exact)', () => {
    const msgs: Msg[] = [
      { type: 'user', message: { content: [{ type: 'text', text: 'abc' }] } },
    ]
    expect(estimateMessageTokens(msgs, deps)).toBe(4)
  })

  test('zero tokens stays zero (no false 1)', () => {
    expect(estimateMessageTokens([], deps)).toBe(0)
  })
})

describe('estimateMessageTokens — multi-message accumulation', () => {
  test('user + assistant text accumulated', () => {
    const msgs: Msg[] = [
      { type: 'user', message: { content: [{ type: 'text', text: 'abc' }] } },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'def' }] },
      },
    ]
    expect(estimateMessageTokens(msgs, deps)).toBe(Math.ceil(6 * (4 / 3)))
  })

  test('non-array content silently skipped', () => {
    const msgs: Msg[] = [
      { type: 'user', message: { content: 'plain string' } },
      { type: 'user', message: { content: [{ type: 'text', text: 'abc' }] } },
    ]
    // Only the second counts.
    expect(estimateMessageTokens(msgs, deps)).toBe(4)
  })

  test('missing message field silently skipped', () => {
    const msgs: Msg[] = [
      { type: 'user' },
      { type: 'user', message: { content: [{ type: 'text', text: 'abc' }] } },
    ]
    expect(estimateMessageTokens(msgs, deps)).toBe(4)
  })
})
