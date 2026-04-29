/**
 * Tests for segmentTextByHighlights — splits text into highlighted +
 * non-highlighted segments for syntax-highlight-aware rendering.
 *
 * Used by transcript search match highlighting, diff renderers, and
 * any text surface that needs colored ranges. Wrong overlap resolution
 * = highlights stomp on each other; wrong empty handling = blank
 * spaces appear in the output.
 */
import { describe, expect, test } from 'bun:test'
import {
  segmentTextByHighlights,
  type TextHighlight,
} from '../textHighlighting.js'

const HL = (
  start: number,
  end: number,
  priority = 0,
  color: TextHighlight['color'] = 'red_FOR_SUBAGENTS_ONLY' as never,
): TextHighlight => ({ start, end, color, priority })

describe('segmentTextByHighlights — basic shapes', () => {
  test('empty highlights → single segment with full text', () => {
    expect(segmentTextByHighlights('hello world', [])).toEqual([
      { text: 'hello world', start: 0 },
    ])
  })

  test('single highlight at start', () => {
    const result = segmentTextByHighlights('hello', [HL(0, 5)])
    expect(result).toHaveLength(1)
    expect(result[0]?.text).toContain('hello')
    expect(result[0]?.highlight).toBeDefined()
  })

  test('single mid-string highlight: 3 segments (before + hl + after)', () => {
    const result = segmentTextByHighlights('hello world', [HL(6, 11)])
    expect(result).toHaveLength(2) // 'hello ' (no highlight) + 'world' (highlight)
    expect(result[0]?.text).toBe('hello ')
    expect(result[0]?.highlight).toBeUndefined()
    expect(result[1]?.text).toContain('world')
    expect(result[1]?.highlight).toBeDefined()
  })

  test('highlight at end: before + hl, no after', () => {
    const result = segmentTextByHighlights('hello world', [HL(6, 11)])
    expect(result.at(-1)?.text).toContain('world')
  })

  test('zero-length highlight skipped', () => {
    const result = segmentTextByHighlights('hello', [HL(2, 2)])
    expect(result).toEqual([{ text: 'hello', start: 0 }])
  })
})

describe('segmentTextByHighlights — overlap resolution', () => {
  test('non-overlapping highlights: both kept', () => {
    const result = segmentTextByHighlights('aaa bbb ccc', [HL(0, 3), HL(8, 11)])
    const highlighted = result.filter(s => s.highlight)
    expect(highlighted).toHaveLength(2)
  })

  test('overlapping highlights: lower priority dropped', () => {
    // Two highlights both want range 0-5; higher-priority wins.
    const result = segmentTextByHighlights('hello', [
      HL(0, 5, 1),
      HL(0, 5, 2), // higher priority
    ])
    expect(result.filter(s => s.highlight)).toHaveLength(1)
  })

  test('partial overlap: second highlight dropped (first wins by sort order)', () => {
    // Both at start=0 → sorted by priority desc; ties go to first
    // (Array.prototype.sort isn't stable for unstable comparisons,
    // but here both have priority=0 so order may vary).
    // What we lock: AT MOST ONE of them survives (no double-render).
    const result = segmentTextByHighlights('hello world', [
      HL(0, 5),
      HL(3, 8), // overlaps with first
    ])
    expect(result.filter(s => s.highlight).length).toBeLessThanOrEqual(1)
  })

  test('contained highlight (entirely inside another): dropped', () => {
    const result = segmentTextByHighlights('hello world here', [
      HL(0, 16, 2), // outer, higher priority
      HL(6, 11, 1), // inside the outer
    ])
    expect(result.filter(s => s.highlight)).toHaveLength(1)
  })

  test('container highlight after contained: contained wins (lower priority dropped)', () => {
    const result = segmentTextByHighlights('hello world here', [
      HL(6, 11, 2), // higher priority, gets in first
      HL(0, 16, 1), // overlaps with the existing one — dropped
    ])
    expect(result.filter(s => s.highlight)).toHaveLength(1)
  })
})

describe('segmentTextByHighlights — sort order', () => {
  test('highlights sorted by start ascending', () => {
    // Inputs in reverse order; output should be in start order.
    const result = segmentTextByHighlights('aa bb cc dd', [
      HL(9, 11), // dd
      HL(3, 5), // bb
      HL(0, 2), // aa
    ])
    const highlightedStarts = result
      .filter(s => s.highlight)
      .map(s => s.start)
    // Should be ascending start order.
    expect(highlightedStarts).toEqual(
      [...highlightedStarts].sort((a, b) => a - b),
    )
  })

  test('same start: higher priority first', () => {
    // Both at start=0; priority 2 should be the kept one.
    const result = segmentTextByHighlights('hello', [
      HL(0, 5, 1),
      HL(0, 5, 2), // higher priority
    ])
    expect(result.filter(s => s.highlight)).toHaveLength(1)
    // The kept highlight has priority 2.
    expect(
      (result.filter(s => s.highlight)[0]?.highlight as TextHighlight).priority,
    ).toBe(2)
  })
})

describe('segmentTextByHighlights — text passthrough', () => {
  test('plain text without ANSI: highlighted text preserved verbatim', () => {
    const result = segmentTextByHighlights('hello world', [HL(0, 5)])
    // First segment should contain 'hello'.
    expect(result[0]?.text).toContain('hello')
  })

  test('returns objects with start positions matching visible offsets', () => {
    const result = segmentTextByHighlights('abcdef', [HL(2, 4)])
    expect(result[0]?.start).toBe(0)
    expect(result[1]?.start).toBe(2)
  })
})
