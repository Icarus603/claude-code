/**
 * Tests for createContentSummary — formats structured tool result
 * blocks (text + image) into a human-readable summary line for UI
 * display of MCP tool results.
 *
 * Wrong summary = misleading bullet count (e.g. "[1 image]" when
 * there are 0); partial preview text leaking past the 200-char cap;
 * empty bracket blocks ("[ ]") in the middle of strings.
 */
import { describe, expect, test } from 'bun:test'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { createContentSummary } from '../utils.js'

const text = (s: string): ContentBlockParam =>
  ({ type: 'text', text: s }) as ContentBlockParam

const image = (): ContentBlockParam =>
  ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'xx' },
  }) as ContentBlockParam

describe('createContentSummary — empty / single block', () => {
  test('empty array → "MCP Result: " (no bullets, no preview)', () => {
    expect(createContentSummary([])).toBe('MCP Result: ')
  })

  test('single text block: shows 1 text block bullet', () => {
    expect(createContentSummary([text('hello')])).toContain('1 text block')
  })

  test('single image block: shows 1 image bullet', () => {
    expect(createContentSummary([image()])).toContain('1 image')
  })
})

describe('createContentSummary — text preview rules', () => {
  test('text under 200 chars: shown verbatim, NO ellipsis', () => {
    const r = createContentSummary([text('short text')])
    expect(r).toContain('short text')
    expect(r).not.toContain('...')
  })

  test('text exactly 200 chars: shown verbatim, NO ellipsis', () => {
    const r = createContentSummary([text('a'.repeat(200))])
    expect(r).toContain('a'.repeat(200))
    expect(r).not.toContain('...')
  })

  test('text > 200 chars: truncated with ellipsis', () => {
    const r = createContentSummary([text('a'.repeat(250))])
    expect(r).toContain('a'.repeat(200))
    expect(r).toContain('...')
    // Should NOT contain 250 chars (exceeds preview cap)
    expect(r).not.toContain('a'.repeat(201))
  })

  test('multiple text blocks: each previewed separately', () => {
    const r = createContentSummary([text('first'), text('second')])
    expect(r).toContain('first')
    expect(r).toContain('second')
    expect(r).toContain('2 text blocks') // pluralized
  })
})

describe('createContentSummary — image counting', () => {
  test('multiple images counted', () => {
    const r = createContentSummary([image(), image(), image()])
    expect(r).toContain('3 images') // pluralized
  })

  test('single image: NOT pluralized', () => {
    const r = createContentSummary([image()])
    expect(r).toContain('1 image')
    expect(r).not.toContain('1 images')
  })
})

describe('createContentSummary — mixed content', () => {
  test('text + image: both shown in summary', () => {
    const r = createContentSummary([text('hi'), image()])
    expect(r).toContain('1 image')
    expect(r).toContain('1 text block')
  })

  test('order: image counts shown BEFORE text counts', () => {
    // Lock that the function emits image counts first.
    const r = createContentSummary([text('first'), image(), text('second')])
    const imageIdx = r.indexOf('image')
    const textIdx = r.indexOf('text block')
    expect(imageIdx).toBeLessThan(textIdx)
  })

  test('text previews appear AFTER counts, separated by double-newline', () => {
    const r = createContentSummary([text('preview content')])
    // Format: "MCP Result: [1 text block]\n\npreview content"
    const blockIdx = r.indexOf('text block')
    const previewIdx = r.indexOf('preview content')
    expect(previewIdx).toBeGreaterThan(blockIdx)
    expect(r.slice(blockIdx, previewIdx)).toContain('\n\n')
  })
})

describe('createContentSummary — non-text/non-image blocks', () => {
  test('tool_use block ignored (not text or image)', () => {
    const r = createContentSummary([
      { type: 'tool_use', id: 'x', name: 'X', input: {} } as ContentBlockParam,
    ])
    // Not counted as image OR text block; both counts are 0.
    expect(r).toContain('MCP Result: ')
    expect(r).not.toContain('image')
    expect(r).not.toContain('text block')
  })

  test('text + tool_use: only text counted', () => {
    const r = createContentSummary([
      text('a'),
      { type: 'tool_use', id: 'x', name: 'X', input: {} } as ContentBlockParam,
    ])
    expect(r).toContain('1 text block')
    expect(r).not.toContain('image')
  })
})

describe('createContentSummary — output format', () => {
  test('always starts with "MCP Result: "', () => {
    expect(createContentSummary([])).toMatch(/^MCP Result: /)
    expect(createContentSummary([text('x')])).toMatch(/^MCP Result: /)
  })

  test('counts joined with ", "', () => {
    const r = createContentSummary([image(), text('x')])
    // [1 image], [1 text block] → "[1 image], [1 text block]"
    expect(r).toContain('], [')
  })
})
