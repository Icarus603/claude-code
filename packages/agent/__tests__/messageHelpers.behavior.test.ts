import { describe, expect, test } from 'bun:test'

import {
  getLastAssistantMessage,
  hasToolCallsInLastAssistantTurn,
} from '../messages.ts'

/**
 * Pin message-traversal helpers. Both are hot-path (called every REPL
 * render and every compaction trigger), and both have implementation
 * subtleties that easy refactors break:
 *
 *  - getLastAssistantMessage uses findLast (NOT filter().last) for O(1)
 *    avg performance on long histories.
 *  - hasToolCallsInLastAssistantTurn iterates BACKWARDS and stops at the
 *    first assistant message — only the most recent assistant turn
 *    counts, not "any tool call ever in this session".
 */
describe('message traversal helpers', () => {
  describe('getLastAssistantMessage', () => {
    test('empty array → undefined', () => {
      expect(getLastAssistantMessage([])).toBeUndefined()
    })

    test('only user messages → undefined', () => {
      const messages = [
        { type: 'user', message: { content: 'a' } } as any,
        { type: 'user', message: { content: 'b' } } as any,
      ]
      expect(getLastAssistantMessage(messages)).toBeUndefined()
    })

    test('returns the LAST assistant message (not first)', () => {
      const messages = [
        { type: 'assistant', message: { content: 'first', id: 'a1' } } as any,
        { type: 'user', message: { content: 'q' } } as any,
        { type: 'assistant', message: { content: 'second', id: 'a2' } } as any,
        { type: 'user', message: { content: 'q2' } } as any,
        { type: 'assistant', message: { content: 'third', id: 'a3' } } as any,
      ]
      const result = getLastAssistantMessage(messages)
      expect(result?.message.id).toBe('a3')
    })

    test('handles interleaved tool_use blocks (each assistant turn is a candidate)', () => {
      const messages = [
        { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }], id: 'a1' } } as any,
        { type: 'progress', data: 'x' } as any,
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1' }], id: 'a2' } } as any,
      ]
      expect(getLastAssistantMessage(messages)?.message.id).toBe('a2')
    })
  })

  describe('hasToolCallsInLastAssistantTurn', () => {
    test('empty → false', () => {
      expect(hasToolCallsInLastAssistantTurn([])).toBe(false)
    })

    test('user messages only → false', () => {
      expect(
        hasToolCallsInLastAssistantTurn([
          { type: 'user', message: { content: 'q' } } as any,
        ]),
      ).toBe(false)
    })

    test('assistant message WITH tool_use block → true', () => {
      const messages = [
        { type: 'user', message: { content: 'q' } } as any,
        {
          type: 'assistant',
          message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] },
        } as any,
      ]
      expect(hasToolCallsInLastAssistantTurn(messages)).toBe(true)
    })

    test('assistant message WITHOUT tool_use → false', () => {
      const messages = [
        { type: 'user', message: { content: 'q' } } as any,
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'just a response' }] },
        } as any,
      ]
      expect(hasToolCallsInLastAssistantTurn(messages)).toBe(false)
    })

    test('only the LAST assistant turn counts (not historical tool calls)', () => {
      // Previous turn had a tool call, but current turn is just text.
      // The function should return FALSE because the LAST assistant turn
      // is text-only.
      const messages = [
        {
          type: 'assistant',
          message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] },
        } as any,
        { type: 'user', message: { content: 'q2' } } as any,
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'no tools this time' }] },
        } as any,
      ]
      expect(hasToolCallsInLastAssistantTurn(messages)).toBe(false)
    })

    test('string content (not array) → false (no tool_use blocks in string form)', () => {
      const messages = [
        { type: 'assistant', message: { content: 'hello' } } as any,
      ]
      expect(hasToolCallsInLastAssistantTurn(messages)).toBe(false)
    })
  })
})
