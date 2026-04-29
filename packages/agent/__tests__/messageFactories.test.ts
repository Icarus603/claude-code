/**
 * Tests for messageFactories — every message type the runtime persists
 * to the JSONL transcript flows through one of these factories.
 *
 * Wrong default ([No content] vs raw '') is consequential: empty strings
 * persisted to disk break recordTranscript's deduplication on resume,
 * and they trigger the inc-4586 turn-boundary bug in capybara.
 *
 * Wrong UUID generation (or omitted timestamp) makes the chain
 * unparseable on resume.
 */
import { describe, expect, mock, test } from 'bun:test'

// logForDebugging in messageFactories goes through host bindings which
// aren't installed in test context. Stub the logging module so the
// boundary-message factory doesn't crash on logForDebugging.
mock.module('../internal/logging.js', () => ({
  logForDebugging: () => {},
}))

const {
  createAssistantAPIErrorMessage,
  createMicrocompactBoundaryMessage,
  createSystemMessage,
  createToolUseSummaryMessage,
  createUserInterruptionMessage,
  createUserMessage,
} = await import('../internal/messageFactories.js')

describe('createUserMessage', () => {
  test('basic string content message', () => {
    const m = createUserMessage({ content: 'hello' })
    expect(m.type).toBe('user')
    expect(m.message.role).toBe('user')
    expect(m.message.content).toBe('hello')
    expect(typeof m.uuid).toBe('string')
    expect(m.uuid.length).toBeGreaterThan(0)
    expect(typeof m.timestamp).toBe('string')
  })

  test('empty string content gets [No content] sentinel', () => {
    // Per inc-4586: zero-length tool/user content leads to
    // turn-boundary bugs in some models. Replace with sentinel.
    const m = createUserMessage({ content: '' })
    expect(m.message.content).toBe('(no content)')
  })

  test('array content (tool_result blocks) is preserved as-is', () => {
    const m = createUserMessage({
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
      ],
    })
    expect(Array.isArray(m.message.content)).toBe(true)
    expect((m.message.content as Array<{ tool_use_id: string }>)[0]?.tool_use_id).toBe('t1')
  })

  test('isMeta and toolUseResult flow through', () => {
    const m = createUserMessage({
      content: 'x',
      isMeta: true,
      toolUseResult: { custom: 'data' },
    })
    expect(m.isMeta).toBe(true)
    expect(m.toolUseResult).toEqual({ custom: 'data' })
  })

  test('UUIDs are unique across calls', () => {
    const a = createUserMessage({ content: 'x' })
    const b = createUserMessage({ content: 'x' })
    expect(a.uuid).not.toBe(b.uuid)
  })

  test('timestamp is ISO 8601', () => {
    const m = createUserMessage({ content: 'x' })
    // Should round-trip through Date
    expect(new Date(m.timestamp).toISOString()).toBe(m.timestamp)
  })
})

describe('createUserInterruptionMessage', () => {
  test('default (no toolUse) emits non-tool interrupt text', () => {
    const m = createUserInterruptionMessage({})
    expect(Array.isArray(m.message.content)).toBe(true)
    const block = (m.message.content as Array<{ text: string }>)[0]
    expect(block?.text).toBe('[Request interrupted by user]')
  })

  test('toolUse=true emits tool-specific interrupt text', () => {
    const m = createUserInterruptionMessage({ toolUse: true })
    const block = (m.message.content as Array<{ text: string }>)[0]
    expect(block?.text).toBe('[Request interrupted by user for tool use]')
  })

  test('SKIP_FIRST_PROMPT_PATTERN must match this text', () => {
    // Cross-check: the pattern that filters interrupts out of session
    // titles must match the text emitted here. If they drift apart, the
    // interrupt message becomes the visible session title.
    const SKIP_PATTERN =
      /^(?:\s*<[a-z][\w-]*[\s>]|\[Request interrupted by user[^\]]*\])/
    const m1 = createUserInterruptionMessage({})
    const m2 = createUserInterruptionMessage({ toolUse: true })
    const t1 = (m1.message.content as Array<{ text: string }>)[0]?.text ?? ''
    const t2 = (m2.message.content as Array<{ text: string }>)[0]?.text ?? ''
    expect(SKIP_PATTERN.test(t1)).toBe(true)
    expect(SKIP_PATTERN.test(t2)).toBe(true)
  })
})

describe('createSystemMessage', () => {
  test('basic system message has subtype=informational and isMeta=false', () => {
    const m = createSystemMessage('hello', 'info')
    expect(m.type).toBe('system')
    expect(m.subtype).toBe('informational')
    expect(m.content).toBe('hello')
    expect(m.level).toBe('info')
    expect(m.isMeta).toBe(false)
  })

  test('toolUseID is included when provided', () => {
    const m = createSystemMessage('hello', 'info', 'tu1')
    expect(m.toolUseID).toBe('tu1')
  })

  test('toolUseID is OMITTED (not undefined) when not provided', () => {
    // Documented behavior: spreading `{ toolUseID }` only when truthy.
    // This means the JSONL output doesn't have a `"toolUseID":undefined`
    // field that would round-trip differently.
    const m = createSystemMessage('hello', 'info')
    expect('toolUseID' in m).toBe(false)
  })

  test('preventContinuation=true is included as literal true', () => {
    const m = createSystemMessage('x', 'info', undefined, true)
    expect(m.preventContinuation).toBe(true)
  })

  test('preventContinuation=false is OMITTED', () => {
    const m = createSystemMessage('x', 'info', undefined, false)
    expect('preventContinuation' in m).toBe(false)
  })
})

describe('createAssistantAPIErrorMessage', () => {
  test('content empty string falls back to [No content]', () => {
    const m = createAssistantAPIErrorMessage({ content: '' })
    const block = (m.message.content as Array<{ text: string }>)[0]
    expect(block?.text).toBe('(no content)')
  })

  test('non-empty content is preserved', () => {
    const m = createAssistantAPIErrorMessage({ content: 'API err: 500' })
    const block = (m.message.content as Array<{ text: string }>)[0]
    expect(block?.text).toBe('API err: 500')
  })

  test('stop_reason is end_turn (so the loop stops)', () => {
    const m = createAssistantAPIErrorMessage({ content: 'x' })
    expect(m.message.stop_reason).toBe('end_turn')
  })

  test('isApiErrorMessage flag is true', () => {
    const m = createAssistantAPIErrorMessage({ content: 'x' })
    expect(m.isApiErrorMessage).toBe(true)
  })

  test('apiError / error / errorDetails flow through', () => {
    const m = createAssistantAPIErrorMessage({
      content: 'x',
      apiError: { code: 500 },
      error: new Error('boom'),
      errorDetails: 'request_id=abc',
    })
    expect(m.apiError).toEqual({ code: 500 })
    expect(m.error).toBeInstanceOf(Error)
    expect(m.errorDetails).toBe('request_id=abc')
  })

  test('usage is zeroed out (no token cost for error messages)', () => {
    const m = createAssistantAPIErrorMessage({ content: 'x' })
    expect(m.message.usage).toEqual({ input_tokens: 0, output_tokens: 0 })
  })
})

describe('createToolUseSummaryMessage', () => {
  test('preserves summary string and ids', () => {
    const m = createToolUseSummaryMessage('did stuff', ['t1', 't2'])
    expect(m.type).toBe('tool_use_summary')
    expect(m.summary).toBe('did stuff')
    expect(m.precedingToolUseIds).toEqual(['t1', 't2'])
  })

  test('empty ids array is preserved (not converted to undefined)', () => {
    const m = createToolUseSummaryMessage('x', [])
    expect(m.precedingToolUseIds).toEqual([])
  })
})

describe('createMicrocompactBoundaryMessage', () => {
  test('basic shape with metadata', () => {
    const m = createMicrocompactBoundaryMessage(
      'auto',
      10000,
      4000,
      ['t1', 't2'],
      ['a1'],
    )
    expect(m.type).toBe('system')
    expect(m.subtype).toBe('microcompact_boundary')
    expect(m.content).toBe('Context microcompacted')
    expect(m.microcompactMetadata).toEqual({
      trigger: 'auto',
      preTokens: 10000,
      tokensSaved: 4000,
      compactedToolIds: ['t1', 't2'],
      clearedAttachmentUUIDs: ['a1'],
    })
  })

  test('zero-savings call still produces valid boundary message', () => {
    const m = createMicrocompactBoundaryMessage('auto', 5000, 0, [], [])
    expect(m.microcompactMetadata.tokensSaved).toBe(0)
    expect(m.microcompactMetadata.compactedToolIds).toEqual([])
  })

  test('UUID and timestamp are present', () => {
    const m = createMicrocompactBoundaryMessage('auto', 1, 1, [], [])
    expect(typeof m.uuid).toBe('string')
    expect(typeof m.timestamp).toBe('string')
    expect(new Date(m.timestamp).toISOString()).toBe(m.timestamp)
  })
})
