import { describe, expect, test } from 'bun:test'
import { extractConversationText } from '../sessionTitle.js'
import type { Message } from '../messageShapes.js'

function userMsg(content: string | Array<{ type: string; text?: string }>): Message {
  return {
    type: 'user',
    message: { content },
  } as Message
}

function assistantMsg(
  content: string | Array<{ type: string; text?: string }>,
): Message {
  return {
    type: 'assistant',
    message: { content },
  } as Message
}

describe('extractConversationText — message-type filter', () => {
  test('user + assistant text concatenated with newline', () => {
    expect(
      extractConversationText([
        userMsg('hello'),
        assistantMsg('world'),
      ]),
    ).toBe('hello\nworld')
  })

  test('system messages skipped', () => {
    expect(
      extractConversationText([
        { type: 'system', message: { content: 'system info' } } as Message,
        userMsg('real'),
      ]),
    ).toBe('real')
  })

  test('progress messages skipped', () => {
    expect(
      extractConversationText([
        { type: 'progress', message: { content: 'progress' } } as Message,
        userMsg('real'),
      ]),
    ).toBe('real')
  })

  test('attachment messages skipped', () => {
    expect(
      extractConversationText([
        { type: 'attachment' } as Message,
        userMsg('real'),
      ]),
    ).toBe('real')
  })
})

describe('extractConversationText — content type', () => {
  test('string content propagated verbatim', () => {
    expect(extractConversationText([userMsg('hello world')])).toBe(
      'hello world',
    )
  })

  test('array content — only text blocks extracted', () => {
    expect(
      extractConversationText([
        userMsg([
          { type: 'text', text: 'block1' },
          { type: 'image', text: 'should-not-appear' },
          { type: 'text', text: 'block2' },
        ]),
      ]),
    ).toBe('block1\nblock2')
  })

  test('text block without `text` field skipped', () => {
    // The check is: 'type' === 'text' AND 'text' in block. A malformed
    // text block without the field is skipped.
    expect(
      extractConversationText([
        userMsg([{ type: 'text' } as { type: string }]),
      ]),
    ).toBe('')
  })

  test('non-string non-array content (e.g. unexpected shape) skipped', () => {
    expect(
      extractConversationText([
        {
          type: 'user',
          message: { content: 42 as unknown as string },
        } as Message,
      ]),
    ).toBe('')
  })

  test('empty array content → empty result for that message', () => {
    expect(extractConversationText([userMsg([])])).toBe('')
  })

  test('empty string content propagated', () => {
    // The function pushes empty strings unconditionally for string content.
    // Joined with \n, two empty user messages produce just '\n'.
    expect(extractConversationText([userMsg(''), userMsg('')])).toBe('\n')
  })
})

describe('extractConversationText — isMeta filter', () => {
  test('isMeta:true messages skipped', () => {
    const meta = {
      type: 'user',
      isMeta: true,
      message: { content: 'meta content' },
    } as Message
    expect(extractConversationText([meta, userMsg('real')])).toBe('real')
  })

  test('isMeta:false messages NOT skipped', () => {
    // The check is `'isMeta' in msg && msg.isMeta` — falsy isMeta passes.
    const notMeta = {
      type: 'user',
      isMeta: false,
      message: { content: 'real' },
    } as Message
    expect(extractConversationText([notMeta])).toBe('real')
  })

  test('missing isMeta field NOT treated as meta', () => {
    expect(extractConversationText([userMsg('real')])).toBe('real')
  })
})

describe('extractConversationText — origin filter', () => {
  test('origin.kind === "human" allowed', () => {
    const human = {
      type: 'user',
      origin: { kind: 'human' },
      message: { content: 'real' },
    } as Message
    expect(extractConversationText([human])).toBe('real')
  })

  test('origin.kind !== "human" filtered (e.g. agent, channel)', () => {
    // Channel/agent-originated messages are not part of the human
    // conversation thread for title-generation purposes.
    const agent = {
      type: 'user',
      origin: { kind: 'agent' },
      message: { content: 'agent output' },
    } as Message
    const channel = {
      type: 'user',
      origin: { kind: 'channel' },
      message: { content: 'channel notification' },
    } as Message
    expect(
      extractConversationText([agent, channel, userMsg('real')]),
    ).toBe('real')
  })

  test('missing origin field allowed (treated as human)', () => {
    expect(extractConversationText([userMsg('real')])).toBe('real')
  })
})

describe('extractConversationText — tail truncation (1000 chars)', () => {
  test('text under 1000 chars passed through unchanged', () => {
    const text = 'a'.repeat(500)
    expect(extractConversationText([userMsg(text)])).toBe(text)
  })

  test('text exactly 1000 chars passed through (boundary inclusive)', () => {
    const text = 'a'.repeat(1000)
    expect(extractConversationText([userMsg(text)])).toBe(text)
  })

  test('text over 1000 chars TAIL-sliced (last 1000 chars)', () => {
    // CRITICAL: tail-slice means the END of the conversation wins, not
    // the start. This is per design — recent context is more relevant
    // for title generation. A future change to .slice(0, 1000) would
    // silently shift to leading-prefix and degrade title quality.
    const head = 'X'.repeat(500)
    const tail = 'a'.repeat(1000)
    const result = extractConversationText([userMsg(head + tail)])
    expect(result).toBe(tail)
    expect(result.startsWith('X')).toBe(false)
  })

  test('truncation applies to JOINED text, not per-message', () => {
    // The truncation runs on the joined parts.join('\n'), so even if
    // individual messages are < 1000, the total may exceed it.
    const m1 = 'x'.repeat(800)
    const m2 = 'y'.repeat(800) // total: 800 + 1 + 800 = 1601 chars
    const result = extractConversationText([userMsg(m1), userMsg(m2)])
    expect(result.length).toBe(1000)
    expect(result.endsWith('y')).toBe(true)
  })
})

describe('extractConversationText — empty / edge cases', () => {
  test('empty messages array → empty string', () => {
    expect(extractConversationText([])).toBe('')
  })

  test('all-meta messages → empty string', () => {
    const meta = (text: string) =>
      ({
        type: 'user',
        isMeta: true,
        message: { content: text },
      }) as Message
    expect(extractConversationText([meta('a'), meta('b')])).toBe('')
  })

  test('only non-conversation types → empty string', () => {
    expect(
      extractConversationText([
        { type: 'system', message: { content: 'x' } } as Message,
        { type: 'progress', message: { content: 'y' } } as Message,
      ]),
    ).toBe('')
  })

  test('mixed user+assistant+meta — only non-meta human user/assistant joined', () => {
    const meta = {
      type: 'user',
      isMeta: true,
      message: { content: 'meta' },
    } as Message
    const result = extractConversationText([
      userMsg('first'),
      meta,
      assistantMsg('second'),
      userMsg('third'),
    ])
    expect(result).toBe('first\nsecond\nthird')
  })
})
