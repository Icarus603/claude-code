/**
 * Tests for the image-dimension auto-strip helper — port-correctness
 * against ant v2.1.136 `Lx9` (parser, 2539.js) and `Zv3` (mutator,
 * 4758.js).
 */
import { describe, expect, test } from 'bun:test'
import type Anthropic from '@anthropic-ai/sdk'
import { APIError } from '@anthropic-ai/sdk'
import {
  parseImageDimensionExceededError,
  stripOversizedImageFromMessages,
} from '../imageDimensionStrip.js'

describe('parseImageDimensionExceededError (ant Lx9)', () => {
  test('400 with both dim + coord patterns → coords', () => {
    const e = new APIError(
      400,
      {
        error: {
          message:
            'messages.2.content.1.image dimensions exceed max allowed size of 2000 pixels',
        },
      },
      'messages.2.content.1.image dimensions exceed max allowed size of 2000 pixels',
      new Headers(),
    )
    const out = parseImageDimensionExceededError(e)
    expect(out).toEqual({ messageIdx: 2, contentIdx: 1, pixelLimit: 2000 })
  })

  test('returns undefined for 400 without image-dim message', () => {
    const e = new APIError(
      400,
      { error: { message: 'context_length_exceeded' } },
      'context_length_exceeded',
      new Headers(),
    )
    expect(parseImageDimensionExceededError(e)).toBeUndefined()
  })

  test('returns undefined when dim hint present but no coord pinpoint', () => {
    // Without the messages.N.content.M.image pinpoint, we can't safely
    // strip — could be a bulk error referencing several images.
    const e = new APIError(
      400,
      { error: { message: 'dimensions exceed max allowed size of 2000 pixels' } },
      'dimensions exceed max allowed size of 2000 pixels',
      new Headers(),
    )
    expect(parseImageDimensionExceededError(e)).toBeUndefined()
  })

  test('returns undefined for non-400 status', () => {
    const e = new APIError(
      500,
      {
        error: {
          message:
            'messages.0.content.0.image dimensions exceed max allowed size 2000 pixels',
        },
      },
      'messages.0.content.0.image dimensions exceed max allowed size 2000 pixels',
      new Headers(),
    )
    expect(parseImageDimensionExceededError(e)).toBeUndefined()
  })

  test('returns undefined for non-APIError input', () => {
    expect(parseImageDimensionExceededError(new Error('boom'))).toBeUndefined()
    expect(parseImageDimensionExceededError(undefined)).toBeUndefined()
    expect(parseImageDimensionExceededError(null)).toBeUndefined()
  })

  test('regex is case-sensitive (ant v2.1.136 has no /i flag)', () => {
    // ant `Lx9` uses /dimensions exceed max allowed size.*\d+ pixels/
    // with NO `i` flag — pin that. If the API ever ships title-case
    // wording, ant would NOT strip-retry and we must match that
    // behaviour to keep parity (rather than false-positive into a
    // retry loop on an unrelated error).
    const e = new APIError(
      400,
      {
        error: {
          message:
            'messages.0.content.0.image Dimensions Exceed Max Allowed Size 2000 pixels',
        },
      },
      'messages.0.content.0.image Dimensions Exceed Max Allowed Size 2000 pixels',
      new Headers(),
    )
    expect(parseImageDimensionExceededError(e)).toBeUndefined()
  })

  test('captures pixel count even when number is embedded after preposition', () => {
    // Lazy match means `of 2000` style messages still pin the count
    // correctly. Pin this so a future regression to greedy `.*` (which
    // captured "2" from "of 2000") gets caught.
    const e = new APIError(
      400,
      {
        error: {
          message:
            'messages.0.content.0.image dimensions exceed max allowed size of 2000 pixels',
        },
      },
      'messages.0.content.0.image dimensions exceed max allowed size of 2000 pixels',
      new Headers(),
    )
    expect(parseImageDimensionExceededError(e)).toEqual({
      messageIdx: 0,
      contentIdx: 0,
      pixelLimit: 2000,
    })
  })
})

describe('stripOversizedImageFromMessages (ant Zv3)', () => {
  function makeMessages(): Anthropic.MessageParam[] {
    return [
      { role: 'user' as const, content: 'first' },
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'before' },
          {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: 'image/png' as const,
              data: 'xxx',
            },
          },
          { type: 'text' as const, text: 'after' },
        ],
      },
    ]
  }

  test('replaces the targeted image with placeholder text', () => {
    const messages = makeMessages()
    const patched = stripOversizedImageFromMessages(messages, {
      messageIdx: 1,
      contentIdx: 1,
    })
    const block = (patched[1]!.content as Anthropic.ContentBlockParam[])[1]
    expect(block?.type).toBe('text')
    expect((block as { text: string }).text).toContain('[Image removed')
    // Other blocks intact
    expect(
      (
        (patched[1]!.content as Anthropic.ContentBlockParam[])[0] as {
          text: string
        }
      ).text,
    ).toBe('before')
    expect(
      (
        (patched[1]!.content as Anthropic.ContentBlockParam[])[2] as {
          text: string
        }
      ).text,
    ).toBe('after')
  })

  test('returns SAME array reference when block is not an image (no-op)', () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'just text' }],
      },
    ]
    const patched = stripOversizedImageFromMessages(messages, {
      messageIdx: 0,
      contentIdx: 0,
    })
    expect(patched).toBe(messages) // referential equality — ant Zv3 returns H unchanged
  })

  test('returns SAME array reference when role is not user', () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'just text' }],
      },
    ]
    const patched = stripOversizedImageFromMessages(messages, {
      messageIdx: 0,
      contentIdx: 0,
    })
    expect(patched).toBe(messages)
  })

  test('returns SAME array reference when content is string-only', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user' as const, content: 'plain string' },
    ]
    const patched = stripOversizedImageFromMessages(messages, {
      messageIdx: 0,
      contentIdx: 0,
    })
    expect(patched).toBe(messages)
  })

  test('returns SAME array reference when messageIdx is out of range', () => {
    const messages = makeMessages()
    const patched = stripOversizedImageFromMessages(messages, {
      messageIdx: 99,
      contentIdx: 0,
    })
    expect(patched).toBe(messages)
  })

  test('returns SAME array reference when contentIdx is out of range', () => {
    const messages = makeMessages()
    const patched = stripOversizedImageFromMessages(messages, {
      messageIdx: 1,
      contentIdx: 99,
    })
    expect(patched).toBe(messages)
  })

  test('does NOT mutate the input array', () => {
    const messages = makeMessages()
    const before = JSON.stringify(messages)
    stripOversizedImageFromMessages(messages, { messageIdx: 1, contentIdx: 1 })
    expect(JSON.stringify(messages)).toBe(before)
  })

  test('only the target message changes; siblings stay referentially equal', () => {
    const messages = makeMessages()
    const patched = stripOversizedImageFromMessages(messages, {
      messageIdx: 1,
      contentIdx: 1,
    })
    expect(patched[0]).toBe(messages[0]) // first user message unchanged
    expect(patched[1]).not.toBe(messages[1]) // target was rebuilt
  })
})
