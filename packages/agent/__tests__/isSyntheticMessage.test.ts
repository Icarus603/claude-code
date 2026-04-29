/**
 * Tests for isSyntheticMessage — detects whether a message is one of
 * the canonical SYNTHETIC_MESSAGES (interrupted-by-user, no-response-
 * requested, etc.) so callers can suppress them from transcript export
 * or attribution counts.
 *
 * Wrong detection = either:
 *   - Real user message classified as synthetic: silently dropped
 *     from transcript / attribution
 *   - Synthetic message classified as real: inflates user-prompt
 *     count, leaks into transcript export the user shares
 */
import { describe, expect, test } from 'bun:test'
import { isSyntheticMessage, SYNTHETIC_MESSAGES } from '../messages.js'
import type { Message } from '../messageShapes.js'

const userText = (text: string): Message =>
  ({
    type: 'user',
    uuid: 'uuid',
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
    },
  }) as Message

describe('isSyntheticMessage — known synthetic markers', () => {
  test('"[Request interrupted by user]" → true', () => {
    expect(isSyntheticMessage(userText('[Request interrupted by user]'))).toBe(true)
  })

  test('"[Request interrupted by user for tool use]" → true', () => {
    expect(
      isSyntheticMessage(userText('[Request interrupted by user for tool use]')),
    ).toBe(true)
  })

  test('"No response requested." → true', () => {
    expect(isSyntheticMessage(userText('No response requested.'))).toBe(true)
  })

  test('every member of SYNTHETIC_MESSAGES set returns true', () => {
    for (const m of SYNTHETIC_MESSAGES) {
      expect(isSyntheticMessage(userText(m))).toBe(true)
    }
  })
})

describe('isSyntheticMessage — non-synthetic content', () => {
  test('regular user message → false', () => {
    expect(isSyntheticMessage(userText('hello world'))).toBe(false)
  })

  test('similar-but-different text → false (exact match required)', () => {
    expect(isSyntheticMessage(userText('Request interrupted by user'))).toBe(
      false,
    )
    expect(isSyntheticMessage(userText('[Request interrupted]'))).toBe(false)
    expect(isSyntheticMessage(userText('no response requested.'))).toBe(false) // case
  })

  test('empty string → false', () => {
    expect(isSyntheticMessage(userText(''))).toBe(false)
  })

  test('whitespace-padded synthetic → false (no trim)', () => {
    expect(isSyntheticMessage(userText(' [Request interrupted by user] '))).toBe(
      false,
    )
  })
})

describe('isSyntheticMessage — message types not eligible', () => {
  test('progress message → false (returns early)', () => {
    expect(
      isSyntheticMessage({
        type: 'progress',
        toolUseID: 'x',
        parentToolUseID: 'p',
        data: {},
        uuid: 'u',
        timestamp: 't',
      } as never),
    ).toBe(false)
  })

  test('attachment message → false', () => {
    expect(
      isSyntheticMessage({
        type: 'attachment',
        attachment: { type: 'whatever' },
      } as never),
    ).toBe(false)
  })

  test('system message → false', () => {
    expect(
      isSyntheticMessage({
        type: 'system',
        content: '[Request interrupted by user]',
      } as never),
    ).toBe(false)
  })

  test('assistant message with synthetic-text content → checks text[0]', () => {
    // Documented: assistant messages CAN be synthetic-marked. Locks
    // that the function inspects content[0] regardless of role.
    const r = isSyntheticMessage({
      type: 'assistant',
      uuid: 'uuid',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'No response requested.' }],
      },
    } as never)
    expect(r).toBe(true)
  })
})

describe('isSyntheticMessage — content shape edge cases', () => {
  test('user message with string content (not array) → false', () => {
    // Documented contract: function requires Array.isArray content.
    expect(
      isSyntheticMessage({
        type: 'user',
        uuid: 'uuid',
        message: {
          role: 'user',
          content: '[Request interrupted by user]',
        },
      } as never),
    ).toBe(false)
  })

  test('empty content array → false', () => {
    expect(
      isSyntheticMessage({
        type: 'user',
        uuid: 'uuid',
        message: {
          role: 'user',
          content: [],
        },
      } as never),
    ).toBe(false)
  })

  test('first block is non-text (image, tool_use) → false', () => {
    expect(
      isSyntheticMessage({
        type: 'user',
        uuid: 'uuid',
        message: {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: '' },
            },
          ],
        },
      } as never),
    ).toBe(false)
  })

  test('multi-block message: only first text block is checked', () => {
    // Documented: function ONLY checks content[0]. Subsequent blocks
    // are ignored even if they contain synthetic markers.
    const r = isSyntheticMessage({
      type: 'user',
      uuid: 'uuid',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'first block (not synthetic)' },
          { type: 'text', text: '[Request interrupted by user]' },
        ],
      },
    } as never)
    expect(r).toBe(false)
  })
})
