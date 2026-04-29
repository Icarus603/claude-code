import { describe, expect, test } from 'bun:test'
import {
  extractTextContent,
  getContentText,
  getUserMessageText,
  textForResubmit,
} from '../messages.js'
import type { Message, UserMessage } from '../messageShapes.js'

describe('extractTextContent — text-block joiner', () => {
  test('empty array → empty string', () => {
    expect(extractTextContent([])).toBe('')
  })

  test('single text block extracted', () => {
    expect(extractTextContent([{ type: 'text', text: 'hello' }])).toBe('hello')
  })

  test('multiple text blocks joined with empty separator (default)', () => {
    expect(
      extractTextContent([
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('ab')
  })

  test('custom separator joins blocks', () => {
    expect(
      extractTextContent(
        [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
        '\n',
      ),
    ).toBe('a\nb')
  })

  test('non-text blocks filtered out', () => {
    expect(
      extractTextContent([
        { type: 'text', text: 'keep' },
        { type: 'image', source: { type: 'base64', data: 'x' } },
        { type: 'tool_use', id: 't', name: 'X', input: {} },
        { type: 'text', text: 'also-keep' },
      ]),
    ).toBe('keepalso-keep')
  })

  test('text block missing `text` field — joined as empty (Array.join coerces undefined)', () => {
    // Filter only checks type === 'text'. Map then accesses .text which
    // is undefined. Array.prototype.join coerces undefined to '' (NOT
    // the string 'undefined'). Documents the safe-by-accident behavior:
    // a malformed text block silently disappears from output.
    const r = extractTextContent([
      { type: 'text' } as { type: 'text'; text: string },
    ])
    expect(r).toBe('')
  })

  test('mix of valid + invalid text blocks — only undefineds drop', () => {
    expect(
      extractTextContent([
        { type: 'text', text: 'a' },
        { type: 'text' } as { type: 'text'; text: string }, // missing field
        { type: 'text', text: 'b' },
      ]),
    ).toBe('ab')
  })

  test('readonly arrays accepted (structural typing)', () => {
    const blocks: ReadonlyArray<{ readonly type: string; readonly text?: string }> =
      Object.freeze([{ type: 'text', text: 'frozen' }])
    expect(extractTextContent(blocks as never)).toBe('frozen')
  })
})

describe('getContentText — string vs array routing', () => {
  test('string content → returned verbatim (no trim)', () => {
    expect(getContentText('hello world')).toBe('hello world')
  })

  test('string with leading/trailing whitespace preserved', () => {
    // CRITICAL: only the array branch trims. String branch passes through
    // unchanged. A refactor that unifies via `result.trim()` would silently
    // strip whitespace from string-content paths.
    expect(getContentText('  spaced  ')).toBe('  spaced  ')
  })

  test('empty string → empty string (NOT null)', () => {
    expect(getContentText('')).toBe('')
  })

  test('array content joined with \\n then trimmed', () => {
    expect(
      getContentText([
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ] as never),
    ).toBe('a\nb')
  })

  test('array with trim-empty result returns null', () => {
    // The function returns `result || null` — empty after trim → null.
    expect(getContentText([] as never)).toBeNull()
  })

  test('array with whitespace-only text → null after trim', () => {
    expect(
      getContentText([{ type: 'text', text: '   ' }] as never),
    ).toBeNull()
  })

  test('non-string non-array → null', () => {
    expect(getContentText(null as never)).toBeNull()
    expect(getContentText(undefined as never)).toBeNull()
    expect(getContentText({} as never)).toBeNull()
  })
})

describe('getUserMessageText — user-only filter', () => {
  function userMsg(content: string | Array<{ type: string; text?: string }>): Message {
    return { type: 'user', message: { content } } as Message
  }

  test('user message string content → returned', () => {
    expect(getUserMessageText(userMsg('hi'))).toBe('hi')
  })

  test('user message array content → joined+trimmed', () => {
    expect(
      getUserMessageText(userMsg([{ type: 'text', text: 'hi' }])),
    ).toBe('hi')
  })

  test('non-user message types → null', () => {
    expect(
      getUserMessageText({
        type: 'assistant',
        message: { content: 'reply' },
      } as Message),
    ).toBeNull()
    expect(
      getUserMessageText({
        type: 'system',
        message: { content: 'sys' },
      } as Message),
    ).toBeNull()
  })

  test('user message with empty array → null', () => {
    expect(getUserMessageText(userMsg([]))).toBeNull()
  })
})

describe('textForResubmit — bash-input precedence', () => {
  function userMsg(content: string): UserMessage {
    return { type: 'user', message: { content } } as UserMessage
  }

  test('plain prompt — mode=prompt, text passthrough', () => {
    expect(textForResubmit(userMsg('what is 2+2'))).toEqual({
      text: 'what is 2+2',
      mode: 'prompt',
    })
  })

  test('bash-input wins over command-name (precedence)', () => {
    // The function checks bash-input FIRST. Even if both tags present,
    // bash-input dominates.
    expect(
      textForResubmit(
        userMsg(
          '<bash-input>ls -la</bash-input><command-name>compact</command-name>',
        ),
      ),
    ).toEqual({ text: 'ls -la', mode: 'bash' })
  })

  test('command-name without args → "name " (trailing space)', () => {
    // The format is `${cmd} ${args}` with args defaulting to empty
    // string. Result: "compact " with trailing space. Documents this.
    expect(
      textForResubmit(userMsg('<command-name>compact</command-name>')),
    ).toEqual({ text: 'compact ', mode: 'prompt' })
  })

  test('command-name with command-args', () => {
    expect(
      textForResubmit(
        userMsg(
          '<command-name>review</command-name><command-args>PR-123</command-args>',
        ),
      ),
    ).toEqual({ text: 'review PR-123', mode: 'prompt' })
  })

  test('non-user message → null', () => {
    expect(
      textForResubmit({
        type: 'assistant',
        message: { content: 'no' },
      } as unknown as UserMessage),
    ).toBeNull()
  })

  test('user message with no text content → null', () => {
    expect(
      textForResubmit({
        type: 'user',
        message: { content: [] },
      } as unknown as UserMessage),
    ).toBeNull()
  })

  test('plain prompt with no tags goes through stripIdeContextTags', () => {
    // The fallback branch: text 經 stripIdeContextTags. For non-IDE
    // input it should pass through unchanged.
    expect(textForResubmit(userMsg('please help'))).toEqual({
      text: 'please help',
      mode: 'prompt',
    })
  })

  test('empty bash-input tag → empty bash text', () => {
    // <bash-input></bash-input> — extractTag returns null on empty
    // content (per extractTag's `if (depth === 0 && content)` guard).
    // So bash-input branch falls through to command-name → null →
    // stripIdeContextTags branch.
    expect(
      textForResubmit(userMsg('<bash-input></bash-input>')),
    ).toEqual({ text: '<bash-input></bash-input>', mode: 'prompt' })
  })
})
