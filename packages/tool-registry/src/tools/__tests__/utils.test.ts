import { describe, expect, test } from 'bun:test'
import {
  getToolUseIDFromParentMessage,
  tagMessagesWithToolUseID,
} from '../utils.js'

type Msg = Parameters<typeof tagMessagesWithToolUseID>[0][number]

describe('tagMessagesWithToolUseID', () => {
  test('tags user messages with sourceToolUseID', () => {
    const messages: Msg[] = [
      { type: 'user', message: { content: 'hi' } } as Msg,
    ]
    const tagged = tagMessagesWithToolUseID(messages, 'tu_123')
    expect((tagged[0] as { sourceToolUseID: string }).sourceToolUseID).toBe(
      'tu_123',
    )
  })

  test('preserves all other fields when tagging user message', () => {
    const messages: Msg[] = [
      {
        type: 'user',
        message: { content: 'original' },
        uuid: 'msg-uuid',
      } as Msg,
    ]
    const tagged = tagMessagesWithToolUseID(messages, 'tu_x')
    expect((tagged[0] as { uuid: string }).uuid).toBe('msg-uuid')
    expect((tagged[0] as { type: string }).type).toBe('user')
  })

  test('attachment messages are NOT tagged (only user)', () => {
    const messages: Msg[] = [
      { type: 'attachment', attachment: { type: 'image' } } as never,
    ]
    const tagged = tagMessagesWithToolUseID(messages, 'tu_x')
    // Reference equality: attachment was passed through unmodified.
    expect(tagged[0]).toBe(messages[0])
  })

  test('system messages are NOT tagged', () => {
    const messages: Msg[] = [
      { type: 'system', content: 'sys msg' } as never,
    ]
    const tagged = tagMessagesWithToolUseID(messages, 'tu_x')
    expect(tagged[0]).toBe(messages[0])
  })

  test('mixed array: only user tagged, others passed through', () => {
    const userMsg: Msg = { type: 'user', message: { content: 'u' } } as Msg
    const sysMsg: Msg = { type: 'system' } as never
    const tagged = tagMessagesWithToolUseID([userMsg, sysMsg], 'tu_x')
    expect((tagged[0] as { sourceToolUseID: string }).sourceToolUseID).toBe(
      'tu_x',
    )
    expect(tagged[1]).toBe(sysMsg)
  })

  test('undefined toolUseID returns original array reference', () => {
    // Performance / identity contract: when toolUseID is undefined,
    // the input is returned unchanged (same reference). Callers that
    // compare via === for "did anything change?" depend on this.
    const messages: Msg[] = [
      { type: 'user', message: { content: 'u' } } as Msg,
    ]
    expect(tagMessagesWithToolUseID(messages, undefined)).toBe(messages)
  })

  test('empty array returns array (different reference, but empty)', () => {
    const result = tagMessagesWithToolUseID([], 'tu_x')
    expect(result).toEqual([])
  })

  test('empty toolUseID falsy → returns original (same as undefined)', () => {
    // `!toolUseID` treats empty string as falsy → same path as
    // undefined. Documents this — caller can pass '' to no-op.
    const messages: Msg[] = [
      { type: 'user', message: { content: 'u' } } as Msg,
    ]
    expect(tagMessagesWithToolUseID(messages, '')).toBe(messages)
  })
})

describe('getToolUseIDFromParentMessage', () => {
  test('returns id of matching tool_use block', () => {
    const parent = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'thinking' },
          { type: 'tool_use', id: 'tu_1', name: 'Bash', input: {} },
        ],
      },
    } as Parameters<typeof getToolUseIDFromParentMessage>[0]
    expect(getToolUseIDFromParentMessage(parent, 'Bash')).toBe('tu_1')
  })

  test('returns FIRST matching block (find semantics)', () => {
    const parent = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'first', name: 'Bash', input: {} },
          { type: 'tool_use', id: 'second', name: 'Bash', input: {} },
        ],
      },
    } as Parameters<typeof getToolUseIDFromParentMessage>[0]
    expect(getToolUseIDFromParentMessage(parent, 'Bash')).toBe('first')
  })

  test('returns undefined when tool name not present', () => {
    const parent = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Edit', input: {} }],
      },
    } as Parameters<typeof getToolUseIDFromParentMessage>[0]
    expect(getToolUseIDFromParentMessage(parent, 'Bash')).toBeUndefined()
  })

  test('returns undefined when content is non-array (string)', () => {
    const parent = {
      type: 'assistant',
      message: { content: 'plain string' },
    } as Parameters<typeof getToolUseIDFromParentMessage>[0]
    expect(getToolUseIDFromParentMessage(parent, 'Bash')).toBeUndefined()
  })

  test('case-sensitive name matching', () => {
    const parent = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: {} }],
      },
    } as Parameters<typeof getToolUseIDFromParentMessage>[0]
    expect(getToolUseIDFromParentMessage(parent, 'bash')).toBeUndefined()
  })

  test('skips text/thinking blocks even with matching name field', () => {
    const parent = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Bash', name: 'Bash' },
          { type: 'tool_use', id: 'tu_1', name: 'Bash', input: {} },
        ],
      },
    } as Parameters<typeof getToolUseIDFromParentMessage>[0]
    expect(getToolUseIDFromParentMessage(parent, 'Bash')).toBe('tu_1')
  })

  test('returns undefined for empty content array', () => {
    const parent = {
      type: 'assistant',
      message: { content: [] },
    } as Parameters<typeof getToolUseIDFromParentMessage>[0]
    expect(getToolUseIDFromParentMessage(parent, 'Bash')).toBeUndefined()
  })
})
