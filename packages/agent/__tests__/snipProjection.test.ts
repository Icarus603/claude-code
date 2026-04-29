import { describe, expect, test } from 'bun:test'
import {
  isSnipBoundaryMessage,
  projectSnippedView,
} from '../compaction/snipProjection.js'

type Msg = Parameters<typeof projectSnippedView>[0][number]

describe('isSnipBoundaryMessage', () => {
  test('returns true for system message with subtype=snip_boundary', () => {
    expect(
      isSnipBoundaryMessage({ type: 'system', subtype: 'snip_boundary' } as Msg),
    ).toBe(true)
  })

  test('returns false for system message with different subtype', () => {
    expect(
      isSnipBoundaryMessage({
        type: 'system',
        subtype: 'compact_boundary',
      } as Msg),
    ).toBe(false)
  })

  test('returns false for system message with no subtype', () => {
    expect(isSnipBoundaryMessage({ type: 'system' } as Msg)).toBe(false)
  })

  test('returns false for assistant messages even with the subtype', () => {
    // Critical contract: type must be 'system'. A user/assistant message
    // that happens to carry a `subtype: snip_boundary` field is NOT a
    // boundary marker — only system messages can be boundaries.
    expect(
      isSnipBoundaryMessage({
        type: 'assistant',
        subtype: 'snip_boundary',
      } as never),
    ).toBe(false)
  })

  test('returns false for user messages', () => {
    expect(isSnipBoundaryMessage({ type: 'user' } as never)).toBe(false)
  })

  test('subtype check is exact string match (case-sensitive)', () => {
    expect(
      isSnipBoundaryMessage({
        type: 'system',
        subtype: 'SNIP_BOUNDARY',
      } as Msg),
    ).toBe(false)
  })
})

describe('projectSnippedView', () => {
  // Contract: returns slice from boundary onwards. If no boundary, return
  // the full input unchanged. Critical for compaction — the model only
  // sees the post-snip portion of the conversation.

  test('returns the full input when no boundary present', () => {
    const messages = [
      { type: 'user' },
      { type: 'assistant' },
    ] as Msg[]
    expect(projectSnippedView(messages)).toBe(messages) // same reference
  })

  test('returns slice starting at the boundary', () => {
    const messages = [
      { type: 'user' },
      { type: 'assistant' },
      { type: 'system', subtype: 'snip_boundary' },
      { type: 'user' },
      { type: 'assistant' },
    ] as Msg[]
    const result = projectSnippedView(messages)
    expect(result).toHaveLength(3)
    expect(result[0]!.type).toBe('system')
    expect(result[1]!.type).toBe('user')
    expect(result[2]!.type).toBe('assistant')
  })

  test('boundary at index 0 returns the full array', () => {
    const messages = [
      { type: 'system', subtype: 'snip_boundary' },
      { type: 'user' },
    ] as Msg[]
    const result = projectSnippedView(messages)
    expect(result).toHaveLength(2)
  })

  test('boundary at last index returns just the boundary', () => {
    const messages = [
      { type: 'user' },
      { type: 'assistant' },
      { type: 'system', subtype: 'snip_boundary' },
    ] as Msg[]
    const result = projectSnippedView(messages)
    expect(result).toHaveLength(1)
    expect((result[0] as { subtype: string }).subtype).toBe('snip_boundary')
  })

  test('multiple boundaries — only the FIRST one wins', () => {
    // findIndex returns the first match. If a future refactor changes to
    // findLast (or reverse), the model would see a different conversation
    // slice — silent semantic break.
    const messages = [
      { type: 'user' },
      { type: 'system', subtype: 'snip_boundary' },
      { type: 'assistant' },
      { type: 'system', subtype: 'snip_boundary' },
      { type: 'user' },
    ] as Msg[]
    const result = projectSnippedView(messages)
    expect(result).toHaveLength(4)
    // First boundary onwards.
    expect((result[0] as { subtype: string }).subtype).toBe('snip_boundary')
  })

  test('empty input returns empty', () => {
    expect(projectSnippedView([])).toEqual([])
  })

  test('does NOT mutate input', () => {
    const messages: Msg[] = [
      { type: 'user' },
      { type: 'system', subtype: 'snip_boundary' },
    ] as Msg[]
    const before = messages.length
    projectSnippedView(messages)
    expect(messages.length).toBe(before)
  })
})
