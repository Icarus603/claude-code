import { describe, expect, test } from 'bun:test'
import { insertBlockAfterToolResults } from '../contentArray.js'

const block = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  ...extra,
})

describe('insertBlockAfterToolResults — with tool_results', () => {
  test('inserts after the only tool_result', () => {
    const content: unknown[] = [block('tool_result', { id: 't1' })]
    insertBlockAfterToolResults(content, block('cache'))
    // Insert at end → triggers continuation append
    expect(content).toEqual([
      block('tool_result', { id: 't1' }),
      block('cache'),
      { type: 'text', text: '.' },
    ])
  })

  test('inserts after LAST tool_result when multiple', () => {
    const content: unknown[] = [
      block('tool_result', { id: 't1' }),
      block('text', { text: 'middle' }),
      block('tool_result', { id: 't2' }),
      block('text', { text: 'after' }),
    ]
    insertBlockAfterToolResults(content, block('cache'))
    expect(content[3]).toEqual(block('cache'))
    expect(content[4]).toEqual(block('text', { text: 'after' }))
  })

  test('inserts after tool_result and appends text continuation when result is final', () => {
    const content: unknown[] = [
      block('text', { text: 'first' }),
      block('tool_result', { id: 't1' }),
    ]
    insertBlockAfterToolResults(content, block('cache'))
    expect(content[content.length - 1]).toEqual({ type: 'text', text: '.' })
  })

  test('does NOT append continuation when insert is followed by other blocks', () => {
    const content: unknown[] = [
      block('tool_result', { id: 't1' }),
      block('text', { text: 'follow' }),
    ]
    insertBlockAfterToolResults(content, block('cache'))
    // Inserted at index 1 (after tool_result). content.length now 3, insertPos=1 != length-1
    expect(content.length).toBe(3)
    expect(content[content.length - 1]).toEqual(block('text', { text: 'follow' }))
  })
})

describe('insertBlockAfterToolResults — no tool_results', () => {
  test('inserts before last block', () => {
    const content: unknown[] = [
      block('text', { text: 'a' }),
      block('text', { text: 'b' }),
      block('text', { text: 'c' }),
    ]
    insertBlockAfterToolResults(content, block('cache'))
    expect(content).toEqual([
      block('text', { text: 'a' }),
      block('text', { text: 'b' }),
      block('cache'),
      block('text', { text: 'c' }),
    ])
  })

  test('single-element content: inserts at index 0 (becomes first)', () => {
    const content: unknown[] = [block('text', { text: 'only' })]
    insertBlockAfterToolResults(content, block('cache'))
    expect(content).toEqual([block('cache'), block('text', { text: 'only' })])
  })

  test('empty content: inserts at index 0', () => {
    const content: unknown[] = []
    insertBlockAfterToolResults(content, block('cache'))
    expect(content).toEqual([block('cache')])
  })
})

describe('insertBlockAfterToolResults — edge cases', () => {
  test('non-object items in content do not match tool_result', () => {
    const content: unknown[] = ['raw string', null, block('text', { text: 'a' })]
    insertBlockAfterToolResults(content, block('cache'))
    // No tool_result → before last → splice at index 2
    expect(content).toEqual([
      'raw string',
      null,
      block('cache'),
      block('text', { text: 'a' }),
    ])
  })

  test('item without `type` field does not match tool_result', () => {
    const content: unknown[] = [{ id: 'no-type-here' }]
    insertBlockAfterToolResults(content, block('cache'))
    // Treated as no-tool-result branch
    expect(content[0]).toEqual(block('cache'))
  })
})
