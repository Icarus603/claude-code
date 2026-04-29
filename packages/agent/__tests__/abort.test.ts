import { describe, expect, test } from 'bun:test'
import { createSyntheticToolResults, shouldAbort } from '../internal/abort.js'

type Msg = Parameters<typeof createSyntheticToolResults>[0][number]

describe('shouldAbort', () => {
  test('returns false when signal is undefined', () => {
    expect(shouldAbort(undefined)).toBe(false)
  })
  test('returns false when signal is not aborted', () => {
    const c = new AbortController()
    expect(shouldAbort(c.signal)).toBe(false)
  })
  test('returns true when signal is aborted', () => {
    const c = new AbortController()
    c.abort()
    expect(shouldAbort(c.signal)).toBe(true)
  })
  test('returns false when no argument passed (default)', () => {
    expect(shouldAbort()).toBe(false)
  })
})

describe('createSyntheticToolResults — empty / no-tool-use cases', () => {
  test('returns empty array when messages is empty', () => {
    expect(createSyntheticToolResults([])).toEqual([])
  })

  test('returns empty array when no assistant messages', () => {
    expect(
      createSyntheticToolResults([
        { type: 'user', content: 'hello' } as never,
      ]),
    ).toEqual([])
  })

  test('returns empty array when assistant has no tool_use blocks', () => {
    const messages: Msg[] = [
      {
        type: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
      } as never,
    ]
    expect(createSyntheticToolResults(messages)).toEqual([])
  })

  test('returns empty array when assistant content is non-array (string)', () => {
    const messages: Msg[] = [
      { type: 'assistant', content: 'plain string' } as never,
    ]
    expect(createSyntheticToolResults(messages)).toEqual([])
  })
})

describe('createSyntheticToolResults — extracts pending tool_uses from latest assistant', () => {
  test('produces a tool_result for each tool_use block', () => {
    const messages: Msg[] = [
      {
        type: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'Bash', input: {} },
          { type: 'tool_use', id: 'tu_2', name: 'Edit', input: {} },
        ],
      } as never,
    ]
    const results = createSyntheticToolResults(messages)
    expect(results).toHaveLength(2)
    // Order matches the input order.
    expect((results[0] as { tool_use_id: string }).tool_use_id).toBe('tu_1')
    expect((results[1] as { tool_use_id: string }).tool_use_id).toBe('tu_2')
  })

  test('default reason is "interrupted"', () => {
    const messages: Msg[] = [
      {
        type: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: {} }],
      } as never,
    ]
    const results = createSyntheticToolResults(messages)
    expect((results[0] as { content: string }).content).toContain(
      '[interrupted]',
    )
  })

  test('custom reason is interpolated into result content', () => {
    const messages: Msg[] = [
      {
        type: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: {} }],
      } as never,
    ]
    const results = createSyntheticToolResults(messages, 'user-canceled')
    expect((results[0] as { content: string }).content).toContain(
      '[user-canceled]',
    )
  })

  test('marks each result with is_error: true', () => {
    const messages: Msg[] = [
      {
        type: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: {} }],
      } as never,
    ]
    const results = createSyntheticToolResults(messages)
    expect((results[0] as { is_error: boolean }).is_error).toBe(true)
  })

  test('uses block.id as tool_use_id', () => {
    const messages: Msg[] = [
      {
        type: 'assistant',
        content: [{ type: 'tool_use', id: 'unique-id', name: 'Bash', input: {} }],
      } as never,
    ]
    const results = createSyntheticToolResults(messages)
    expect((results[0] as { tool_use_id: string }).tool_use_id).toBe('unique-id')
  })

  test('only the LAST assistant message is examined', () => {
    // Walks backwards from the end; first assistant hit wins.
    const messages: Msg[] = [
      {
        type: 'assistant',
        content: [{ type: 'tool_use', id: 'old', name: 'Bash', input: {} }],
      } as never,
      { type: 'user', content: 'something' } as never,
      {
        type: 'assistant',
        content: [{ type: 'tool_use', id: 'new', name: 'Edit', input: {} }],
      } as never,
    ]
    const results = createSyntheticToolResults(messages)
    expect(results).toHaveLength(1)
    expect((results[0] as { tool_use_id: string }).tool_use_id).toBe('new')
  })

  test('walking backwards stops at the first assistant message found', () => {
    // Even if older assistant messages have tool_use blocks, the loop
    // breaks after the first reverse-traversal hit.
    const messages: Msg[] = [
      {
        type: 'assistant',
        content: [{ type: 'tool_use', id: 'oldest', name: 'X', input: {} }],
      } as never,
      {
        type: 'assistant',
        content: [{ type: 'tool_use', id: 'newest', name: 'Y', input: {} }],
      } as never,
    ]
    const results = createSyntheticToolResults(messages)
    expect(results).toHaveLength(1)
    expect((results[0] as { tool_use_id: string }).tool_use_id).toBe('newest')
  })

  test('non-tool_use blocks in the assistant message are ignored', () => {
    const messages: Msg[] = [
      {
        type: 'assistant',
        content: [
          { type: 'text', text: 'thinking...' },
          { type: 'tool_use', id: 'real_tu', name: 'Bash', input: {} },
          { type: 'thinking', thinking: 'inner' },
        ],
      } as never,
    ]
    const results = createSyntheticToolResults(messages)
    expect(results).toHaveLength(1)
    expect((results[0] as { tool_use_id: string }).tool_use_id).toBe('real_tu')
  })

  test('blocks without an "id" property are skipped', () => {
    const messages: Msg[] = [
      {
        type: 'assistant',
        content: [
          { type: 'tool_use', name: 'Bash', input: {} } as never,
          { type: 'tool_use', id: 'has_id', name: 'Edit', input: {} },
        ],
      } as never,
    ]
    const results = createSyntheticToolResults(messages)
    expect(results).toHaveLength(1)
  })
})
