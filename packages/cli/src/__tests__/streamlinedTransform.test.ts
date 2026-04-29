/**
 * Tests for createStreamlinedTransformer — converts SDK messages into
 * the compact streamlined output mode (--output-format=streamlined).
 *
 * The transformer is stateful (cumulative tool counts reset on each
 * text message). Wrong reset = tool counts leak across user turns;
 * wrong filtering = system messages leak into output.
 */
import { describe, expect, test } from 'bun:test'
import { createStreamlinedTransformer } from '../headless/sdk/session/utils/streamlinedTransform.js'

describe('createStreamlinedTransformer — message filtering', () => {
  test('non-assistant non-result messages return null', () => {
    const t = createStreamlinedTransformer()
    expect(t({ type: 'system' } as never)).toBeNull()
    expect(t({ type: 'user' } as never)).toBeNull()
    expect(t({ type: 'stream_event' } as never)).toBeNull()
    expect(t({ type: 'tool_progress' } as never)).toBeNull()
    expect(t({ type: 'auth_status' } as never)).toBeNull()
    expect(t({ type: 'rate_limit_event' } as never)).toBeNull()
    expect(t({ type: 'control_response' } as never)).toBeNull()
    expect(t({ type: 'control_request' } as never)).toBeNull()
    expect(t({ type: 'control_cancel_request' } as never)).toBeNull()
    expect(t({ type: 'keep_alive' } as never)).toBeNull()
  })

  test('result messages pass through unchanged', () => {
    const t = createStreamlinedTransformer()
    const result = {
      type: 'result',
      structured_output: { foo: 'bar' },
      permission_denials: [],
    } as never
    expect(t(result)).toBe(result)
  })

  test('unknown message type → null (default branch)', () => {
    const t = createStreamlinedTransformer()
    expect(t({ type: 'unknown_thing' } as never)).toBeNull()
  })
})

describe('createStreamlinedTransformer — assistant text messages', () => {
  test('text message → streamlined_text', () => {
    const t = createStreamlinedTransformer()
    const msg = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello' }] },
      session_id: 's1',
      uuid: 'u1',
    } as never
    expect(t(msg)).toEqual({
      type: 'streamlined_text',
      text: 'Hello',
      session_id: 's1',
      uuid: 'u1',
    })
  })

  test('text trimmed (leading/trailing whitespace removed)', () => {
    const t = createStreamlinedTransformer()
    const msg = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: '  Hello world  \n' }] },
      session_id: 's1',
      uuid: 'u1',
    } as never
    const result = t(msg) as { text: string }
    expect(result.text).toBe('Hello world')
  })

  test('multiple text blocks joined with newlines', () => {
    const t = createStreamlinedTransformer()
    const msg = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'line1' },
          { type: 'text', text: 'line2' },
        ],
      },
      session_id: 's1',
      uuid: 'u1',
    } as never
    const result = t(msg) as { text: string }
    expect(result.text).toBe('line1\nline2')
  })

  test('non-array content (string only) → empty text → null (no emit)', () => {
    const t = createStreamlinedTransformer()
    const msg = {
      type: 'assistant',
      message: { content: 'plain string' },
      session_id: 's1',
      uuid: 'u1',
    } as never
    // Documented: extractTextContent only handles arrays; non-array
    // returns ''; tool-only flow runs but with 0 counts → null.
    expect(t(msg)).toBeNull()
  })
})

describe('createStreamlinedTransformer — tool-use accumulation', () => {
  test('Bash tool → "Ran 1 command"', () => {
    const t = createStreamlinedTransformer()
    const msg = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Bash', id: 'tu1', input: {} }],
      },
      session_id: 's1',
      uuid: 'u1',
    } as never
    const result = t(msg) as { tool_summary: string }
    expect(result.tool_summary).toBe('Ran 1 command')
  })

  test('FileRead tool → "Read 1 file"', () => {
    const t = createStreamlinedTransformer()
    const msg = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', id: 'tu1', input: {} },
        ],
      },
      session_id: 's1',
      uuid: 'u1',
    } as never
    const result = t(msg) as { tool_summary: string }
    expect(result.tool_summary).toBe('Read 1 file')
  })

  test('Grep tool → "Searched 1 pattern"', () => {
    const t = createStreamlinedTransformer()
    const msg = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Grep', id: 'tu1', input: {} }],
      },
      session_id: 's1',
      uuid: 'u1',
    } as never
    const result = t(msg) as { tool_summary: string }
    expect(result.tool_summary).toBe('Searched 1 pattern')
  })

  test('Edit tool → "Wrote 1 file"', () => {
    const t = createStreamlinedTransformer()
    const msg = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Edit', id: 'tu1', input: {} }],
      },
      session_id: 's1',
      uuid: 'u1',
    } as never
    const result = t(msg) as { tool_summary: string }
    expect(result.tool_summary).toBe('Wrote 1 file')
  })

  test('Unknown tool → "1 other tool"', () => {
    const t = createStreamlinedTransformer()
    const msg = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'CustomMystery', id: 'tu1', input: {} },
        ],
      },
      session_id: 's1',
      uuid: 'u1',
    } as never
    const result = t(msg) as { tool_summary: string }
    expect(result.tool_summary).toBe('1 other tool')
  })

  test('Multiple tools in one message: counts accumulate', () => {
    const t = createStreamlinedTransformer()
    const msg = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', id: 'tu1', input: {} },
          { type: 'tool_use', name: 'Read', id: 'tu2', input: {} },
          { type: 'tool_use', name: 'Bash', id: 'tu3', input: {} },
        ],
      },
      session_id: 's1',
      uuid: 'u1',
    } as never
    const result = t(msg) as { tool_summary: string }
    expect(result.tool_summary).toBe('Read 2 files, ran 1 command')
  })
})

describe('createStreamlinedTransformer — accumulation across messages', () => {
  test('Counts accumulate across multiple tool-only messages', () => {
    const t = createStreamlinedTransformer()
    const msg1 = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Read', id: 'tu1', input: {} }],
      },
      session_id: 's1',
      uuid: 'u1',
    } as never
    const msg2 = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Read', id: 'tu2', input: {} }],
      },
      session_id: 's1',
      uuid: 'u2',
    } as never
    expect((t(msg1) as { tool_summary: string }).tool_summary).toBe('Read 1 file')
    // Second message: cumulative count = 2
    expect((t(msg2) as { tool_summary: string }).tool_summary).toBe('Read 2 files')
  })

  test('Text message resets the accumulation', () => {
    const t = createStreamlinedTransformer()
    t({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Read', id: 'tu1', input: {} }],
      },
      session_id: 's',
      uuid: 'u1',
    } as never)
    // Text message
    t({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Done with reads' }] },
      session_id: 's',
      uuid: 'u2',
    } as never)
    // Next tool-only message starts fresh count.
    const msg3 = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Read', id: 'tu3', input: {} }],
      },
      session_id: 's',
      uuid: 'u3',
    } as never
    expect((t(msg3) as { tool_summary: string }).tool_summary).toBe('Read 1 file')
  })

  test('Two transformers have independent state', () => {
    const t1 = createStreamlinedTransformer()
    const t2 = createStreamlinedTransformer()
    t1({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Read', id: 'x', input: {} }],
      },
      session_id: 's',
      uuid: 'u',
    } as never)
    // t2 is fresh
    const msg = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Read', id: 'x', input: {} }],
      },
      session_id: 's',
      uuid: 'u',
    } as never
    expect((t2(msg) as { tool_summary: string }).tool_summary).toBe('Read 1 file')
  })
})
