/**
 * Tests for sdkMappers — convert internal Anthropic-shape data to the
 * SDK output format. The mapping is the wire-protocol contract for SDK
 * consumers; a regression silently breaks all SDK clients.
 */
import { describe, expect, test } from 'bun:test'
import {
  localCommandOutputToSDKAssistantMessage,
  toSDKCompactMetadata,
} from '../internal/sdkMappers.js'

describe('toSDKCompactMetadata', () => {
  test('basic metadata: trigger + preTokens, no preservedSegment', () => {
    const result = toSDKCompactMetadata({
      trigger: 'auto',
      preTokens: 42000,
    } as never)
    expect(result).toEqual({
      trigger: 'auto',
      pre_tokens: 42000,
    })
    // preservedSegment OMITTED when not present
    expect(result).not.toHaveProperty('preserved_segment')
  })

  test('with preservedSegment: keys snake_cased', () => {
    const result = toSDKCompactMetadata({
      trigger: 'manual',
      preTokens: 100000,
      preservedSegment: {
        headUuid: 'h1',
        anchorUuid: 'a1',
        tailUuid: 't1',
      },
    } as never)
    expect(result.preserved_segment).toEqual({
      head_uuid: 'h1',
      anchor_uuid: 'a1',
      tail_uuid: 't1',
    })
  })

  test('preservedSegment with extra fields preserves only the three locked keys', () => {
    // Future-proof: if preservedSegment grows, the SDK shape doesn't
    // accidentally expose new fields. Only the documented three.
    const result = toSDKCompactMetadata({
      trigger: 'auto',
      preTokens: 0,
      preservedSegment: {
        headUuid: 'h',
        anchorUuid: 'a',
        tailUuid: 't',
        extraInternalField: 'leak-me',
      },
    } as never)
    expect(result.preserved_segment).toEqual({
      head_uuid: 'h',
      anchor_uuid: 'a',
      tail_uuid: 't',
    })
    expect(result.preserved_segment).not.toHaveProperty('extraInternalField')
    expect(result.preserved_segment).not.toHaveProperty('extra_internal_field')
  })

  test('zero preTokens preserved (not falsy-stripped)', () => {
    const result = toSDKCompactMetadata({
      trigger: 'auto',
      preTokens: 0,
    } as never)
    expect(result.pre_tokens).toBe(0)
  })
})

describe('localCommandOutputToSDKAssistantMessage', () => {
  test('strips ANSI escape codes', () => {
    const result = localCommandOutputToSDKAssistantMessage(
      '\x1b[31mred text\x1b[0m',
      'u1',
      's1',
      'stdout',
      'stderr',
    )
    expect((result.content[0] as { text: string }).text).toBe('red text')
  })

  test('strips configured stdout/stderr wrappers', () => {
    const result = localCommandOutputToSDKAssistantMessage(
      '<stdout>hello</stdout>',
      'u1',
      's1',
      'stdout',
      'stderr',
    )
    expect((result.content[0] as { text: string }).text).toBe('hello')
  })

  test('strips both stdout and stderr wrappers', () => {
    const result = localCommandOutputToSDKAssistantMessage(
      '<stdout>out</stdout> AND <stderr>err</stderr>',
      'u1',
      's1',
      'stdout',
      'stderr',
    )
    expect((result.content[0] as { text: string }).text).toBe('out AND err')
  })

  test('empty content (after stripping) → "(no content)" sentinel', () => {
    // Locks the canonical NO_CONTENT_MESSAGE constant.
    const result = localCommandOutputToSDKAssistantMessage(
      '',
      'u1',
      's1',
      'stdout',
      'stderr',
    )
    expect((result.content[0] as { text: string }).text).toBe('(no content)')
  })

  test('whitespace-only after stripping → "(no content)"', () => {
    const result = localCommandOutputToSDKAssistantMessage(
      '   \n  \t  ',
      'u1',
      's1',
      'stdout',
      'stderr',
    )
    expect((result.content[0] as { text: string }).text).toBe('(no content)')
  })

  test('result shape matches SDKAssistantMessage contract', () => {
    const result = localCommandOutputToSDKAssistantMessage(
      'plain text',
      'uuid-1',
      'session-1',
      'stdout',
      'stderr',
    )
    expect(result.type).toBe('assistant')
    expect(result.uuid).toBe('uuid-1')
    expect(result.session_id).toBe('session-1')
    expect(result.parent_tool_use_id).toBeNull()
    expect(result.message.id).toBe('synthetic-uuid-1')
    expect(result.message.role).toBe('assistant')
    expect(result.message.stop_reason).toBe('end_turn')
    expect(result.message.usage.input_tokens).toBe(0)
    expect(result.message.usage.output_tokens).toBe(0)
  })

  test('content array matches between top-level and message.content', () => {
    // Documented: same content array reference at both locations
    // (the function sets `content` and `message.content` to same value).
    const result = localCommandOutputToSDKAssistantMessage(
      'plain',
      'u',
      's',
      'stdout',
      'stderr',
    )
    expect(result.content).toBe(result.message.content)
  })

  test('multi-line content preserved', () => {
    const result = localCommandOutputToSDKAssistantMessage(
      'line1\nline2\nline3',
      'u',
      's',
      'stdout',
      'stderr',
    )
    expect((result.content[0] as { text: string }).text).toBe(
      'line1\nline2\nline3',
    )
  })

  test('multi-line content INSIDE wrapper still gets stripped', () => {
    const result = localCommandOutputToSDKAssistantMessage(
      '<stdout>line1\nline2</stdout>',
      'u',
      's',
      'stdout',
      'stderr',
    )
    expect((result.content[0] as { text: string }).text).toBe('line1\nline2')
  })

  test('custom tag names work', () => {
    // The function takes stdout/stderr tag names as params, allowing
    // for non-default markup.
    const result = localCommandOutputToSDKAssistantMessage(
      '<my-out>hello</my-out>',
      'u',
      's',
      'my-out',
      'my-err',
    )
    expect((result.content[0] as { text: string }).text).toBe('hello')
  })
})
