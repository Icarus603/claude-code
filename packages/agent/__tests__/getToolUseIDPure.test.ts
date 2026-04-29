import { describe, expect, test } from 'bun:test'
import { getToolUseID, getToolResultIDs } from '../messages.js'
import type { NormalizedMessage } from '../messageShapes.js'

// Helper: build a NormalizedMessage of various shapes.
type Block = { type: string; [k: string]: unknown }

function userWithBlocks(blocks: Block[]): NormalizedMessage {
  return {
    type: 'user',
    message: { content: blocks },
  } as unknown as NormalizedMessage
}

function userWithSourceToolUseID(id: string): NormalizedMessage {
  return {
    type: 'user',
    sourceToolUseID: id,
    message: { content: 'whatever' },
  } as unknown as NormalizedMessage
}

function assistantWithBlocks(blocks: Block[]): NormalizedMessage {
  return {
    type: 'assistant',
    message: { content: blocks },
  } as unknown as NormalizedMessage
}

describe('getToolUseID — assistant message', () => {
  test('first block is tool_use → returns id', () => {
    expect(
      getToolUseID(
        assistantWithBlocks([{ type: 'tool_use', id: 'tu_1', name: 'X' }]),
      ),
    ).toBe('tu_1')
  })

  test('first block is text → null (only first block matters)', () => {
    expect(
      getToolUseID(
        assistantWithBlocks([
          { type: 'text', text: 'thinking' },
          { type: 'tool_use', id: 'tu_2', name: 'X' },
        ]),
      ),
    ).toBeNull()
  })

  test('empty content array → null', () => {
    expect(getToolUseID(assistantWithBlocks([]))).toBeNull()
  })

  test('non-array content (string) → null', () => {
    expect(
      getToolUseID({
        type: 'assistant',
        message: { content: 'plain text' },
      } as unknown as NormalizedMessage),
    ).toBeNull()
  })

  test('first block is string (rare API shape) → null', () => {
    // The check explicitly handles `typeof firstBlock === 'string'` →
    // null. Some old API responses use string content blocks.
    expect(
      getToolUseID({
        type: 'assistant',
        message: { content: ['raw string' as unknown as Block] },
      } as unknown as NormalizedMessage),
    ).toBeNull()
  })
})

describe('getToolUseID — user message', () => {
  test('sourceToolUseID set → returns it (overrides content scan)', () => {
    expect(getToolUseID(userWithSourceToolUseID('tu_src'))).toBe('tu_src')
  })

  test('sourceToolUseID set wins even if content has tool_result', () => {
    // sourceToolUseID is the "tagged-via" ID added by tagMessagesWithToolUseID.
    // It MUST win — the content's tool_result is just incidental.
    expect(
      getToolUseID({
        type: 'user',
        sourceToolUseID: 'tu_winner',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu_loser' }],
        },
      } as unknown as NormalizedMessage),
    ).toBe('tu_winner')
  })

  test('first block tool_result → returns its tool_use_id', () => {
    expect(
      getToolUseID(
        userWithBlocks([
          { type: 'tool_result', tool_use_id: 'tu_3', content: 'r' },
        ]),
      ),
    ).toBe('tu_3')
  })

  test('first block text (not tool_result) → null', () => {
    expect(
      getToolUseID(userWithBlocks([{ type: 'text', text: 'reply' }])),
    ).toBeNull()
  })

  test('empty content → null', () => {
    expect(getToolUseID(userWithBlocks([]))).toBeNull()
  })

  test('non-array content + no sourceToolUseID → null', () => {
    expect(
      getToolUseID({
        type: 'user',
        message: { content: 'plain user message' },
      } as unknown as NormalizedMessage),
    ).toBeNull()
  })
})

describe('getToolUseID — progress / system / attachment', () => {
  test('progress message returns toolUseID field', () => {
    expect(
      getToolUseID({
        type: 'progress',
        toolUseID: 'tu_p',
      } as unknown as NormalizedMessage),
    ).toBe('tu_p')
  })

  test('system informational subtype with toolUseID returns it', () => {
    expect(
      getToolUseID({
        type: 'system',
        subtype: 'informational',
        toolUseID: 'tu_sys',
      } as unknown as NormalizedMessage),
    ).toBe('tu_sys')
  })

  test('system informational without toolUseID returns null', () => {
    expect(
      getToolUseID({
        type: 'system',
        subtype: 'informational',
      } as unknown as NormalizedMessage),
    ).toBeNull()
  })

  test('system NON-informational subtype returns null even with toolUseID', () => {
    // Critical: only 'informational' subtype is associated with a tool_use.
    // 'init', 'compact_boundary' etc. should NOT propagate the field.
    expect(
      getToolUseID({
        type: 'system',
        subtype: 'compact_boundary',
        toolUseID: 'tu_should_not_propagate',
      } as unknown as NormalizedMessage),
    ).toBeNull()
  })
})

describe('getToolResultIDs — flatMap over tool_results', () => {
  test('empty input → empty object', () => {
    expect(getToolResultIDs([])).toEqual({})
  })

  test('extracts tool_use_id from user-with-tool_result-first-block', () => {
    const r = getToolResultIDs([
      userWithBlocks([
        { type: 'tool_result', tool_use_id: 'tu_a', content: 'x' },
      ]),
    ])
    expect(r).toEqual({ tu_a: false })
  })

  test('is_error flag propagates', () => {
    const r = getToolResultIDs([
      userWithBlocks([
        {
          type: 'tool_result',
          tool_use_id: 'tu_a',
          is_error: true,
          content: 'err',
        },
      ]),
    ])
    expect(r).toEqual({ tu_a: true })
  })

  test('missing is_error defaults to false', () => {
    const r = getToolResultIDs([
      userWithBlocks([
        { type: 'tool_result', tool_use_id: 'tu_b', content: 'r' },
      ]),
    ])
    expect(r.tu_b).toBe(false)
  })

  test('non-tool-result first block skipped', () => {
    const r = getToolResultIDs([
      userWithBlocks([{ type: 'text', text: 'hi' }]),
    ])
    expect(r).toEqual({})
  })

  test('assistant messages skipped (only user has tool_result)', () => {
    const r = getToolResultIDs([
      assistantWithBlocks([
        { type: 'tool_result', tool_use_id: 'tu_c' } as unknown as Block,
      ]),
    ])
    expect(r).toEqual({})
  })

  test('multiple tool_result messages — all extracted', () => {
    const r = getToolResultIDs([
      userWithBlocks([
        { type: 'tool_result', tool_use_id: 'tu_a', content: 'a' },
      ]),
      userWithBlocks([
        {
          type: 'tool_result',
          tool_use_id: 'tu_b',
          content: 'b',
          is_error: true,
        },
      ]),
    ])
    expect(r).toEqual({ tu_a: false, tu_b: true })
  })

  test('only FIRST block checked (per implementation comment)', () => {
    // Documents the current contract: only content[0] matters. If a
    // future message has multiple tool_result blocks in one message
    // (rare), only the first is captured.
    const r = getToolResultIDs([
      userWithBlocks([
        { type: 'tool_result', tool_use_id: 'tu_first', content: 'a' },
        { type: 'tool_result', tool_use_id: 'tu_second', content: 'b' },
      ]),
    ])
    expect(r).toEqual({ tu_first: false })
    expect(r.tu_second).toBeUndefined()
  })

  test('non-array content silently skipped', () => {
    const r = getToolResultIDs([
      {
        type: 'user',
        message: { content: 'plain string' },
      } as unknown as NormalizedMessage,
    ])
    expect(r).toEqual({})
  })

  test('duplicates collapse to last-wins (Object.fromEntries semantics)', () => {
    // CRITICAL probe: if the same tool_use_id appears twice (rare but
    // possible during retry), Object.fromEntries keeps the LAST value.
    // Documents this.
    const r = getToolResultIDs([
      userWithBlocks([
        { type: 'tool_result', tool_use_id: 'tu_dup', is_error: false, content: 'first' },
      ]),
      userWithBlocks([
        { type: 'tool_result', tool_use_id: 'tu_dup', is_error: true, content: 'second' },
      ]),
    ])
    expect(r.tu_dup).toBe(true) // last wins
  })
})
