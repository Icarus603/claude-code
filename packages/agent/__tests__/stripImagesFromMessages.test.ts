/**
 * Tests for stripImagesFromMessages — used during compaction to free up
 * context. Images and documents are replaced with `[image]` / `[document]`
 * text placeholders.
 *
 * Wrong stripping = either real text content gets clobbered (data loss
 * during compaction) or image data gets fed to the summarizer (wasted
 * tokens + degraded summary quality).
 */
import { describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import { stripImagesFromMessages } from '../compaction/compact.js'
import type { Message } from '../messageShapes.js'

function user(content: unknown): Message {
  return {
    type: 'user',
    uuid: '00000000-0000-0000-0000-000000000001' as UUID,
    message: { role: 'user', content: content as never },
  } as Message
}

function assistant(content: unknown): Message {
  return {
    type: 'assistant',
    uuid: '00000000-0000-0000-0000-000000000002' as UUID,
    message: { role: 'assistant', content: content as never },
  } as Message
}

describe('stripImagesFromMessages — basic shapes', () => {
  test('empty array returns empty array', () => {
    expect(stripImagesFromMessages([])).toEqual([])
  })

  test('all-text user message returns IDENTICAL reference (no media → no rewrite)', () => {
    // The function returns the SAME reference if nothing changed —
    // important for prompt-cache stability (different reference =
    // different identity in caches).
    const msg = user([{ type: 'text', text: 'hello' }])
    expect(stripImagesFromMessages([msg])[0]).toBe(msg)
  })

  test('assistant messages are NEVER touched (per docstring)', () => {
    // Documented: only user messages contain images.
    const a = assistant([{ type: 'text', text: 'reply' }])
    const result = stripImagesFromMessages([a])
    expect(result[0]).toBe(a)
  })

  test('user with string content is untouched', () => {
    const msg = user('plain text')
    expect(stripImagesFromMessages([msg])[0]).toBe(msg)
  })
})

describe('stripImagesFromMessages — image / document replacement', () => {
  test('image block → text "[image]"', () => {
    const msg = user([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'x' },
      },
    ])
    const result = stripImagesFromMessages([msg])
    const content = (result[0] as typeof msg).message.content as Array<{
      type: string
      text?: string
    }>
    expect(content).toEqual([{ type: 'text', text: '[image]' }])
  })

  test('document block → text "[document]"', () => {
    const msg = user([
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: 'x' },
      },
    ])
    const result = stripImagesFromMessages([msg])
    const content = (result[0] as typeof msg).message.content as Array<{
      type: string
      text?: string
    }>
    expect(content).toEqual([{ type: 'text', text: '[document]' }])
  })

  test('mixed text + image: text preserved, image replaced', () => {
    const msg = user([
      { type: 'text', text: 'before' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'x' },
      },
      { type: 'text', text: 'after' },
    ])
    const result = stripImagesFromMessages([msg])
    const content = (result[0] as typeof msg).message.content as Array<{
      type: string
      text?: string
    }>
    expect(content).toEqual([
      { type: 'text', text: 'before' },
      { type: 'text', text: '[image]' },
      { type: 'text', text: 'after' },
    ])
  })
})

describe('stripImagesFromMessages — tool_result nested media', () => {
  test('image inside tool_result content is stripped', () => {
    const msg = user([
      {
        type: 'tool_result',
        tool_use_id: 't1',
        content: [
          { type: 'text', text: 'screenshot:' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'x' },
          },
        ],
      },
    ])
    const result = stripImagesFromMessages([msg])
    const block = (result[0] as typeof msg).message.content as Array<{
      content: Array<{ type: string; text?: string }>
    }>
    expect(block[0]?.content).toEqual([
      { type: 'text', text: 'screenshot:' },
      { type: 'text', text: '[image]' },
    ])
  })

  test('document inside tool_result is stripped', () => {
    const msg = user([
      {
        type: 'tool_result',
        tool_use_id: 't1',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: 'x' },
          },
        ],
      },
    ])
    const result = stripImagesFromMessages([msg])
    const block = (result[0] as typeof msg).message.content as Array<{
      content: Array<{ type: string; text?: string }>
    }>
    expect(block[0]?.content).toEqual([{ type: 'text', text: '[document]' }])
  })

  test('tool_result with NO media is unchanged (reference equality)', () => {
    const msg = user([
      {
        type: 'tool_result',
        tool_use_id: 't1',
        content: [{ type: 'text', text: 'hello' }],
      },
    ])
    expect(stripImagesFromMessages([msg])[0]).toBe(msg)
  })

  test('tool_result with string content is unchanged', () => {
    // The function only walks INTO tool_result.content if it's an array.
    const msg = user([
      {
        type: 'tool_result',
        tool_use_id: 't1',
        content: 'string output',
      },
    ])
    expect(stripImagesFromMessages([msg])[0]).toBe(msg)
  })
})

describe('stripImagesFromMessages — multiple messages', () => {
  test('only messages with media get rewritten; others pass through by reference', () => {
    const a = user([{ type: 'text', text: 'plain' }])
    const b = user([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'x' },
      },
    ])
    const c = user('string content')
    const result = stripImagesFromMessages([a, b, c])
    expect(result[0]).toBe(a) // unchanged reference
    expect(result[1]).not.toBe(b) // rewritten
    expect(result[2]).toBe(c) // unchanged
  })
})
