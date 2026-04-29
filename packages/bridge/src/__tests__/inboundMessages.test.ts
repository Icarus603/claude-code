import { describe, expect, test } from 'bun:test'
import {
  extractInboundMessageFields,
  normalizeImageBlocks,
} from '../inboundMessages.js'

type Msg = Parameters<typeof extractInboundMessageFields>[0]
type Block = Parameters<typeof normalizeImageBlocks>[0][number]

describe('extractInboundMessageFields — non-user message types', () => {
  test('returns undefined for assistant messages', () => {
    expect(
      extractInboundMessageFields({ type: 'assistant' } as Msg),
    ).toBeUndefined()
  })

  test('returns undefined for system messages', () => {
    expect(
      extractInboundMessageFields({ type: 'system' } as Msg),
    ).toBeUndefined()
  })
})

describe('extractInboundMessageFields — empty / missing content', () => {
  test('returns undefined when message has no message field', () => {
    expect(
      extractInboundMessageFields({ type: 'user' } as Msg),
    ).toBeUndefined()
  })

  test('returns undefined when content is undefined', () => {
    expect(
      extractInboundMessageFields({ type: 'user', message: {} } as Msg),
    ).toBeUndefined()
  })

  test('returns undefined when content is empty string', () => {
    expect(
      extractInboundMessageFields({
        type: 'user',
        message: { content: '' },
      } as Msg),
    ).toBeUndefined()
  })

  test('returns undefined when content is empty array', () => {
    expect(
      extractInboundMessageFields({
        type: 'user',
        message: { content: [] },
      } as Msg),
    ).toBeUndefined()
  })
})

describe('extractInboundMessageFields — string content', () => {
  test('extracts string content unchanged', () => {
    const result = extractInboundMessageFields({
      type: 'user',
      message: { content: 'hello' },
    } as Msg)
    expect(result?.content).toBe('hello')
  })

  test('returns undefined uuid when not present', () => {
    const result = extractInboundMessageFields({
      type: 'user',
      message: { content: 'hello' },
    } as Msg)
    expect(result?.uuid).toBeUndefined()
  })

  test('extracts uuid when present and a string', () => {
    const result = extractInboundMessageFields({
      type: 'user',
      message: { content: 'hello' },
      uuid: '01234567-89ab-cdef-0123-456789abcdef',
    } as Msg)
    expect(result?.uuid).toBe('01234567-89ab-cdef-0123-456789abcdef' as never)
  })

  test('returns undefined uuid when present but not a string', () => {
    // The function checks `typeof msg.uuid === 'string'` — anything else
    // (number, object) is treated as missing.
    const result = extractInboundMessageFields({
      type: 'user',
      message: { content: 'hello' },
      uuid: 12345,
    } as never)
    expect(result?.uuid).toBeUndefined()
  })
})

describe('extractInboundMessageFields — array content', () => {
  test('extracts array content (already well-formed)', () => {
    const content = [{ type: 'text', text: 'hi' }] as Block[]
    const result = extractInboundMessageFields({
      type: 'user',
      message: { content },
    } as Msg)
    expect(result?.content).toEqual(content)
  })

  test('passes content through normalizeImageBlocks (well-formed → reference equality)', () => {
    const content = [{ type: 'text', text: 'hi' }] as Block[]
    const result = extractInboundMessageFields({
      type: 'user',
      message: { content },
    } as Msg)
    // Fast path: no malformed blocks → original reference returned.
    expect(result?.content).toBe(content)
  })
})

describe('normalizeImageBlocks — fast path (no malformed blocks)', () => {
  test('returns the same reference when no image blocks present', () => {
    const blocks = [{ type: 'text', text: 'hi' }] as Block[]
    expect(normalizeImageBlocks(blocks)).toBe(blocks)
  })

  test('returns the same reference when image blocks have media_type set', () => {
    const blocks = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'iVBORw0KGgo...',
        },
      },
    ] as Block[]
    expect(normalizeImageBlocks(blocks)).toBe(blocks)
  })

  test('returns the same reference for non-base64 image source', () => {
    const blocks = [
      {
        type: 'image',
        source: { type: 'url', url: 'http://example.com/img.png' },
      },
    ] as never as Block[]
    expect(normalizeImageBlocks(blocks)).toBe(blocks)
  })

  test('empty array returns same reference', () => {
    const blocks: Block[] = []
    expect(normalizeImageBlocks(blocks)).toBe(blocks)
  })
})

describe('normalizeImageBlocks — slow path (malformed blocks present)', () => {
  test('translates camelCase mediaType → snake_case media_type', () => {
    // Minimal valid base64 PNG (8x8 transparent)
    const PNG =
      'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4//8/w38GIAXDABTjAcdwhB+ZAAAAAElFTkSuQmCC'
    const blocks = [
      {
        type: 'image',
        source: {
          type: 'base64',
          mediaType: 'image/png', // camelCase
          data: PNG,
        },
      },
    ] as never as Block[]
    const out = normalizeImageBlocks(blocks)
    expect(out).not.toBe(blocks)
    expect((out[0] as never as { source: { media_type: string } }).source.media_type).toBe(
      'image/png',
    )
  })

  test('detects format from base64 magic bytes when mediaType is missing', () => {
    // PNG magic bytes
    const PNG =
      'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4//8/w38GIAXDABTjAcdwhB+ZAAAAAElFTkSuQmCC'
    const blocks = [
      {
        type: 'image',
        source: {
          type: 'base64',
          // no media_type or mediaType
          data: PNG,
        },
      },
    ] as never as Block[]
    const out = normalizeImageBlocks(blocks)
    expect((out[0] as never as { source: { media_type: string } }).source.media_type).toBe(
      'image/png',
    )
  })

  test('preserves the original data field unchanged', () => {
    const PNG =
      'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4//8/w38GIAXDABTjAcdwhB+ZAAAAAElFTkSuQmCC'
    const blocks = [
      {
        type: 'image',
        source: { type: 'base64', mediaType: 'image/jpeg', data: PNG },
      },
    ] as never as Block[]
    const out = normalizeImageBlocks(blocks)
    expect((out[0] as never as { source: { data: string } }).source.data).toBe(
      PNG,
    )
  })

  test('only modifies malformed blocks, not well-formed ones in the same array', () => {
    const PNG =
      'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4//8/w38GIAXDABTjAcdwhB+ZAAAAAElFTkSuQmCC'
    const wellFormed: Block = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: PNG },
    } as never
    const malformed: Block = {
      type: 'image',
      source: { type: 'base64', data: PNG },
    } as never
    const blocks = [wellFormed, malformed]
    const out = normalizeImageBlocks(blocks)
    // Well-formed block should be untouched (same reference).
    expect(out[0]).toBe(wellFormed)
    // Malformed block should have media_type set.
    expect(
      (out[1] as never as { source: { media_type: string } }).source.media_type,
    ).toBe('image/png')
  })

  test('preserves text/other block types alongside image blocks', () => {
    const blocks = [
      { type: 'text', text: 'hi' },
      {
        type: 'image',
        source: { type: 'base64', data: 'invalid-base64' },
      },
    ] as never as Block[]
    const out = normalizeImageBlocks(blocks)
    expect(out[0]).toEqual({ type: 'text', text: 'hi' })
  })
})
