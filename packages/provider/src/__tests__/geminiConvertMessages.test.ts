/**
 * Tests for gemini/convertMessages.ts — Anthropic message → Gemini
 * GenerateContent translation.
 */
import { describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import { anthropicMessagesToGemini } from '../gemini/convertMessages.js'

function user(content: unknown): {
  type: 'user'
  uuid: UUID
  message: { content: unknown }
} {
  return {
    type: 'user',
    uuid: '00000000-0000-0000-0000-000000000001' as UUID,
    message: { content },
  }
}

function assistant(content: unknown): {
  type: 'assistant'
  uuid: UUID
  message: { content: unknown }
} {
  return {
    type: 'assistant',
    uuid: '00000000-0000-0000-0000-000000000002' as UUID,
    message: { content },
  }
}

describe('anthropicMessagesToGemini — system instruction', () => {
  test('system prompt produces systemInstruction.parts[0].text', () => {
    const result = anthropicMessagesToGemini(
      [user('hi') as never],
      ['You are X'],
    )
    expect(result.systemInstruction).toBeDefined()
    expect(result.systemInstruction?.parts).toEqual([{ text: 'You are X' }])
  })

  test('multi-segment system joined with double-newline', () => {
    const result = anthropicMessagesToGemini(
      [user('hi') as never],
      ['Part A', 'Part B'],
    )
    expect(result.systemInstruction?.parts[0]?.text).toBe('Part A\n\nPart B')
  })

  test('empty system prompt: NO systemInstruction key', () => {
    // Documented: omit the key when empty — Gemini doesn't accept
    // {systemInstruction: {parts: []}} cleanly.
    const result = anthropicMessagesToGemini([user('hi') as never], [])
    expect(result).not.toHaveProperty('systemInstruction')
  })

  test('falsy items in system prompt array are filtered', () => {
    const result = anthropicMessagesToGemini(
      [user('hi') as never],
      ['ok', '', 'also ok'] as never,
    )
    expect(result.systemInstruction?.parts[0]?.text).toBe('ok\n\nalso ok')
  })
})

describe('anthropicMessagesToGemini — user messages', () => {
  test('plain string content → role: user, parts with text', () => {
    const result = anthropicMessagesToGemini([user('hello') as never], [])
    expect(result.contents).toHaveLength(1)
    expect(result.contents[0]?.role).toBe('user')
    expect(result.contents[0]?.parts[0]).toEqual({ text: 'hello' })
  })

  test('array text-blocks each become parts', () => {
    const result = anthropicMessagesToGemini(
      [
        user([
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ]) as never,
      ],
      [],
    )
    expect(result.contents[0]?.parts.length).toBeGreaterThanOrEqual(2)
  })

  test('non-array content (object): empty parts → message dropped', () => {
    const result = anthropicMessagesToGemini(
      [user({ unexpected: 'shape' }) as never],
      [],
    )
    // No contents emitted because parts.length === 0.
    expect(result.contents).toEqual([])
  })

  test('empty messages list: empty contents', () => {
    const result = anthropicMessagesToGemini([], [])
    expect(result.contents).toEqual([])
  })
})

describe('anthropicMessagesToGemini — assistant messages', () => {
  test('plain string assistant message → role: model, parts with text', () => {
    const result = anthropicMessagesToGemini(
      [assistant('reply') as never],
      [],
    )
    expect(result.contents).toHaveLength(1)
    // Gemini uses 'model' for assistant messages.
    expect(result.contents[0]?.role).toBe('model')
  })

  test('text + tool_use produces functionCall parts', () => {
    const result = anthropicMessagesToGemini(
      [
        assistant([
          { type: 'text', text: 'I will run' },
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'Bash',
            input: { command: 'ls' },
          },
        ]) as never,
      ],
      [],
    )
    expect(result.contents[0]?.role).toBe('model')
    const parts = result.contents[0]?.parts as Array<{
      text?: string
      functionCall?: { name: string; args?: unknown }
    }>
    // At least one functionCall part for Bash
    const fc = parts.find(p => p.functionCall)
    expect(fc?.functionCall?.name).toBe('Bash')
  })

  test('only tool_use, no text: only functionCall part', () => {
    const result = anthropicMessagesToGemini(
      [
        assistant([
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'X',
            input: {},
          },
        ]) as never,
      ],
      [],
    )
    const parts = result.contents[0]?.parts as Array<{
      functionCall?: { name: string }
    }>
    expect(parts.some(p => p.functionCall?.name === 'X')).toBe(true)
  })

  test('tool name look-up for tool_result requires preceding tool_use', () => {
    // Documented: tool_result is matched to its tool_use by id; the
    // tool_use's name flows through to the Gemini functionResponse.
    // This test combines an assistant tool_use with a user tool_result
    // in the same conversation.
    const result = anthropicMessagesToGemini(
      [
        assistant([
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'Bash',
            input: { command: 'ls' },
          },
        ]) as never,
        user([
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: 'output',
          },
        ]) as never,
      ],
      [],
    )
    expect(result.contents).toHaveLength(2)
    expect(result.contents[0]?.role).toBe('model')
    expect(result.contents[1]?.role).toBe('user')
    // user message has functionResponse part with name 'Bash'
    const userParts = result.contents[1]?.parts as Array<{
      functionResponse?: { name?: string }
    }>
    const fr = userParts.find(p => p.functionResponse)
    expect(fr?.functionResponse?.name).toBe('Bash')
  })
})
