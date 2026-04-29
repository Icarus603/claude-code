/**
 * Tests for openai/convertMessages.ts — Anthropic message → OpenAI
 * ChatCompletion message translation.
 *
 * Wrong message ordering breaks the API contract. CRITICAL: the
 * OpenAI API requires tool messages immediately after the assistant
 * message with tool_calls — a user message in between gets the
 * request rejected with "insufficient tool messages following
 * tool_calls". This test file LOCKS that ordering.
 */
import { describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import { anthropicMessagesToOpenAI } from '../openai/convertMessages.js'

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

describe('anthropicMessagesToOpenAI — system prompt', () => {
  test('system prompt prepended as first message', () => {
    const result = anthropicMessagesToOpenAI(
      [user('hi') as never],
      ['You are a helpful assistant'],
    )
    expect(result[0]?.role).toBe('system')
    expect(result[0]?.content).toBe('You are a helpful assistant')
  })

  test('multi-segment system prompt joined with double newline', () => {
    const result = anthropicMessagesToOpenAI(
      [user('hi') as never],
      ['Part 1', 'Part 2'],
    )
    expect(result[0]?.content).toBe('Part 1\n\nPart 2')
  })

  test('empty system prompt → no system message prepended', () => {
    const result = anthropicMessagesToOpenAI([user('hi') as never], [])
    expect(result[0]?.role).toBe('user')
  })

  test('falsy items in system prompt array are filtered', () => {
    const result = anthropicMessagesToOpenAI(
      [user('hi') as never],
      ['ok', '', 'also ok'] as never,
    )
    expect(result[0]?.content).toBe('ok\n\nalso ok')
  })
})

describe('anthropicMessagesToOpenAI — user messages', () => {
  test('plain string content', () => {
    const result = anthropicMessagesToOpenAI([user('hello') as never], [])
    expect(result[0]).toEqual({ role: 'user', content: 'hello' })
  })

  test('array content with text blocks joined by newline', () => {
    const result = anthropicMessagesToOpenAI(
      [
        user([
          { type: 'text', text: 'line 1' },
          { type: 'text', text: 'line 2' },
        ]) as never,
      ],
      [],
    )
    expect(result[0]?.content).toBe('line 1\nline 2')
  })

  test('image block gets multimodal content array', () => {
    const result = anthropicMessagesToOpenAI(
      [
        user([
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'abc123',
            },
          },
        ]) as never,
      ],
      [],
    )
    expect(Array.isArray(result[0]?.content)).toBe(true)
    const c = result[0]?.content as Array<{ type: string; image_url?: { url: string } }>
    expect(c[0]?.type).toBe('image_url')
    expect(c[0]?.image_url?.url).toBe('data:image/png;base64,abc123')
  })

  test('text + image combines into multimodal array', () => {
    const result = anthropicMessagesToOpenAI(
      [
        user([
          { type: 'text', text: 'caption' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'x' },
          },
        ]) as never,
      ],
      [],
    )
    const c = result[0]?.content as Array<{ type: string; text?: string }>
    expect(c).toHaveLength(2)
    expect(c[0]?.type).toBe('text')
    expect(c[0]?.text).toBe('caption')
    expect(c[1]?.type).toBe('image_url')
  })

  test('image with URL source pass-through', () => {
    const result = anthropicMessagesToOpenAI(
      [
        user([
          {
            type: 'image',
            source: { type: 'url', url: 'https://example.com/img.png' },
          },
        ]) as never,
      ],
      [],
    )
    const c = result[0]?.content as Array<{ image_url?: { url: string } }>
    expect(c[0]?.image_url?.url).toBe('https://example.com/img.png')
  })

  test('image with no source → null (filtered out)', () => {
    const result = anthropicMessagesToOpenAI(
      [user([{ type: 'image' }]) as never],
      [],
    )
    // No content emitted — empty user message in result.
    expect(result).toEqual([])
  })
})

describe('anthropicMessagesToOpenAI — tool_result ordering (CRITICAL)', () => {
  test('tool_result becomes tool message with tool_call_id', () => {
    const result = anthropicMessagesToOpenAI(
      [
        user([
          {
            type: 'tool_result',
            tool_use_id: 'call_abc',
            content: 'result text',
          },
        ]) as never,
      ],
      [],
    )
    expect(result[0]).toEqual({
      role: 'tool',
      tool_call_id: 'call_abc',
      content: 'result text',
    })
  })

  test('tool_result with array content (text blocks joined)', () => {
    const result = anthropicMessagesToOpenAI(
      [
        user([
          {
            type: 'tool_result',
            tool_use_id: 'call_x',
            content: [
              { type: 'text', text: 'part1' },
              { type: 'text', text: 'part2' },
            ],
          },
        ]) as never,
      ],
      [],
    )
    expect(result[0]?.content).toBe('part1\npart2')
  })

  test('tool messages emitted BEFORE user message in same Anthropic msg', () => {
    // CRITICAL ORDERING TEST: an Anthropic message with both tool_result
    // and text must produce [tool, user] in OpenAI output, never [user,
    // tool]. The latter triggers "insufficient tool messages following
    // tool_calls" from the API.
    const result = anthropicMessagesToOpenAI(
      [
        user([
          { type: 'text', text: 'continuation prompt' },
          {
            type: 'tool_result',
            tool_use_id: 'call_x',
            content: 'tool output',
          },
        ]) as never,
      ],
      [],
    )
    expect(result[0]?.role).toBe('tool')
    expect(result[1]?.role).toBe('user')
  })

  test('multiple tool_results all emitted before any user message', () => {
    const result = anthropicMessagesToOpenAI(
      [
        user([
          {
            type: 'tool_result',
            tool_use_id: 'call_a',
            content: 'a',
          },
          {
            type: 'tool_result',
            tool_use_id: 'call_b',
            content: 'b',
          },
          { type: 'text', text: 'after' },
        ]) as never,
      ],
      [],
    )
    expect(result.map(m => m.role)).toEqual(['tool', 'tool', 'user'])
  })

  test('only tool_result, no text → only tool message (no empty user)', () => {
    const result = anthropicMessagesToOpenAI(
      [
        user([
          {
            type: 'tool_result',
            tool_use_id: 'call_x',
            content: 'output',
          },
        ]) as never,
      ],
      [],
    )
    expect(result).toHaveLength(1)
    expect(result[0]?.role).toBe('tool')
  })
})

describe('anthropicMessagesToOpenAI — assistant messages', () => {
  test('plain string content → assistant message', () => {
    const result = anthropicMessagesToOpenAI(
      [assistant('reply') as never],
      [],
    )
    expect(result[0]).toEqual({ role: 'assistant', content: 'reply' })
  })

  test('text + tool_use → tool_calls array on assistant', () => {
    const result = anthropicMessagesToOpenAI(
      [
        assistant([
          { type: 'text', text: 'I will run a command' },
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
    const m = result[0] as {
      role: string
      content: string | null
      tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
    }
    expect(m.role).toBe('assistant')
    expect(m.content).toBe('I will run a command')
    expect(m.tool_calls).toHaveLength(1)
    expect(m.tool_calls?.[0]?.id).toBe('tu_1')
    expect(m.tool_calls?.[0]?.function.name).toBe('Bash')
    expect(JSON.parse(m.tool_calls![0]!.function.arguments)).toEqual({
      command: 'ls',
    })
  })

  test('only tool_use, no text → content: null', () => {
    const result = anthropicMessagesToOpenAI(
      [
        assistant([
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'Bash',
            input: {},
          },
        ]) as never,
      ],
      [],
    )
    const m = result[0] as { content: string | null }
    expect(m.content).toBeNull()
  })

  test('thinking blocks SILENTLY DROPPED (per docstring)', () => {
    const result = anthropicMessagesToOpenAI(
      [
        assistant([
          { type: 'thinking', thinking: 'inner monologue', signature: 'sig' },
          { type: 'text', text: 'visible' },
        ]) as never,
      ],
      [],
    )
    expect((result[0] as { content: string }).content).toBe('visible')
  })

  test('input as string is passed through (not double-encoded)', () => {
    const result = anthropicMessagesToOpenAI(
      [
        assistant([
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'X',
            input: '{"already":"json"}', // string
          },
        ]) as never,
      ],
      [],
    )
    const m = result[0] as {
      tool_calls?: Array<{ function: { arguments: string } }>
    }
    expect(m.tool_calls?.[0]?.function.arguments).toBe('{"already":"json"}')
  })

  test('non-array content → empty content', () => {
    const result = anthropicMessagesToOpenAI(
      [{ ...assistant({ unexpected: 'shape' }) } as never],
      [],
    )
    expect((result[0] as { content: string }).content).toBe('')
  })
})
