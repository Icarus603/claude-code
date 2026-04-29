/**
 * Tests for message-history query helpers in messages.ts.
 *
 * getLastAssistantMessage is called on every REPL render (via
 * useFeedbackSurvey) — using findLast vs filter+last matters at scale.
 *
 * hasToolCallsInLastAssistantTurn decides whether the loop continues
 * (auto-tool-use) or stops. A wrong answer there either:
 *   - returns true on a no-tool turn → infinite loop
 *   - returns false on a tool turn → tool calls dropped silently
 */
import { describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import {
  getLastAssistantMessage,
  hasToolCallsInLastAssistantTurn,
} from '../messages.js'
import type { Message } from '../messageShapes.js'

function user(content: unknown): Message {
  return {
    type: 'user',
    uuid: '00000000-0000-0000-0000-000000000001' as UUID,
    message: { content: content as never },
  } as Message
}

function assistant(content: unknown): Message {
  return {
    type: 'assistant',
    uuid: '00000000-0000-0000-0000-000000000002' as UUID,
    message: { content: content as never },
  } as Message
}

describe('getLastAssistantMessage', () => {
  test('empty array → undefined', () => {
    expect(getLastAssistantMessage([])).toBeUndefined()
  })

  test('only-user array → undefined', () => {
    expect(getLastAssistantMessage([user('hi'), user('bye')])).toBeUndefined()
  })

  test('returns last assistant when multiple present', () => {
    const a1 = assistant('first')
    const a2 = assistant('second')
    const r = getLastAssistantMessage([a1, user('mid'), a2])
    expect(r).toBe(a2)
  })

  test('returns assistant even when it is not the last message', () => {
    const a = assistant('reply')
    expect(getLastAssistantMessage([a, user('then this')])).toBe(a)
  })

  test('skips non-assistant types (system, attachment, progress)', () => {
    const a = assistant('reply')
    const messages = [
      a,
      { type: 'system', uuid: 's1' as UUID } as Message,
      { type: 'attachment', uuid: 'at1' as UUID } as Message,
    ]
    expect(getLastAssistantMessage(messages)).toBe(a)
  })

  test('returns latest of consecutive assistants', () => {
    const a1 = assistant('1')
    const a2 = assistant('2')
    const a3 = assistant('3')
    expect(getLastAssistantMessage([a1, a2, a3])).toBe(a3)
  })
})

describe('hasToolCallsInLastAssistantTurn', () => {
  test('empty array → false', () => {
    expect(hasToolCallsInLastAssistantTurn([])).toBe(false)
  })

  test('no assistants → false', () => {
    expect(
      hasToolCallsInLastAssistantTurn([user('hi'), user('bye')]),
    ).toBe(false)
  })

  test('last assistant has tool_use block → true', () => {
    expect(
      hasToolCallsInLastAssistantTurn([
        assistant([{ type: 'tool_use', id: 't1', name: 'X', input: {} }]),
      ]),
    ).toBe(true)
  })

  test('last assistant has only text → false', () => {
    expect(
      hasToolCallsInLastAssistantTurn([
        assistant([{ type: 'text', text: 'reply' }]),
      ]),
    ).toBe(false)
  })

  test('mix of text and tool_use → true (tool_use is the trigger)', () => {
    expect(
      hasToolCallsInLastAssistantTurn([
        assistant([
          { type: 'text', text: 'thinking...' },
          { type: 'tool_use', id: 't1', name: 'X', input: {} },
        ]),
      ]),
    ).toBe(true)
  })

  test('only checks LAST assistant, not earlier ones', () => {
    const earlierWithTool = assistant([
      { type: 'tool_use', id: 't1', name: 'X', input: {} },
    ])
    const laterTextOnly = assistant([{ type: 'text', text: 'done' }])
    expect(
      hasToolCallsInLastAssistantTurn([earlierWithTool, laterTextOnly]),
    ).toBe(false)
  })

  test('skips user messages between, finds last assistant', () => {
    expect(
      hasToolCallsInLastAssistantTurn([
        assistant([{ type: 'tool_use', id: 't1', name: 'X', input: {} }]),
        user('mid'),
        user('mid2'),
      ]),
    ).toBe(true)
  })

  test('assistant with string content (not array) → false', () => {
    // The function only inspects array content. String content is not
    // a tool call by definition.
    expect(
      hasToolCallsInLastAssistantTurn([assistant('plain string')]),
    ).toBe(false)
  })

  test('empty content array → false', () => {
    expect(hasToolCallsInLastAssistantTurn([assistant([])])).toBe(false)
  })

  test('multiple consecutive assistants: last one decides', () => {
    expect(
      hasToolCallsInLastAssistantTurn([
        assistant([{ type: 'tool_use', id: 't1', name: 'X', input: {} }]),
        assistant([{ type: 'text', text: 'final' }]),
      ]),
    ).toBe(false)
  })
})
