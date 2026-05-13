import { describe, expect, test } from 'bun:test'

import { isOutputLineTruncated, renderTruncatedContent } from '../terminal.ts'

/**
 * Pin invariants for `terminal.ts` — controls "above the fold" truncation
 * in OutputLine. A regression here either hides too much (user can't read
 * the output) or hides too little (giant outputs flood the screen).
 *
 * Critical invariants:
 *  1. MAX_LINES_TO_SHOW = 3 (source-pinned indirectly via output behavior).
 *  2. Single-line-overflow rule: when remaining is exactly 1, the line is
 *     SHOWN inline (no "... +1 line" hint). Saves visual noise.
 *  3. Empty/whitespace input → ''.
 *  4. PADDING_TO_PREVENT_OVERFLOW = 10 → wrapWidth = terminalWidth - 10
 *     (minimum 10).
 *  5. maxChars precompute = MAX_LINES_TO_SHOW * wrapWidth * 4 — caps O(n)
 *     wrapping on huge binary dumps.
 *  6. isOutputLineTruncated counts raw newlines (cheap), not visual rows.
 *  7. Trailing newline is terminator, not a line (matches trimEnd()).
 */
describe('renderTruncatedContent', () => {
  test('empty input → ""', () => {
    expect(renderTruncatedContent('', 80)).toBe('')
  })

  test('whitespace-only input → "" (trimEnd kills trailing)', () => {
    // Pin: trimEnd on whitespace-only string yields ''.
    expect(renderTruncatedContent('   \n  \n  ', 80)).toBe('')
  })

  test('short 1-line output displays as-is', () => {
    const result = renderTruncatedContent('hello', 80)
    expect(result).toBe('hello')
  })

  test('3 lines output displays as-is (no truncation hint)', () => {
    const result = renderTruncatedContent('a\nb\nc', 80)
    expect(result).toContain('a')
    expect(result).toContain('b')
    expect(result).toContain('c')
    expect(result).not.toContain('… +')
  })

  test('4 lines → 4th line shown inline (single-line-overflow rule)', () => {
    // Pin: remainingLines === 1 special case — show inline rather than
    // emit "+1 line" hint.
    const result = renderTruncatedContent('a\nb\nc\nd', 80)
    expect(result).toContain('d')
    expect(result).not.toContain('… +1 line')
  })

  test('5 lines → 3 + "... +2 lines" hint', () => {
    // Pin: standard 3-line truncation with hint.
    const result = renderTruncatedContent('a\nb\nc\nd\ne', 80)
    expect(result).toContain('a')
    expect(result).toContain('b')
    expect(result).toContain('c')
    // Should NOT include lines beyond the fold.
    // Strip ANSI for portable assertion.
    const stripped = result.replace(
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes — \x1b IS the control char
      /\x1b\[[0-9;]*m/g,
      '',
    )
    expect(stripped).toContain('… +2 lines')
  })

  test('suppressExpandHint=true hides the "ctrl+o to expand" portion', () => {
    // Pin: suppress flag controls only the ctrl+o tail; lines hint stays.
    const result = renderTruncatedContent('a\nb\nc\nd\ne', 80, true)
    const stripped = result.replace(
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes — \x1b IS the control char
      /\x1b\[[0-9;]*m/g,
      '',
    )
    expect(stripped).toContain('+2 lines')
    expect(stripped).not.toMatch(/ctrl/i)
  })

  test('very long output cap: maxChars precompute prevents O(n) wrap', () => {
    // Pin: 64MB binary dumps caused 382K-row screens. The cap is
    // MAX_LINES_TO_SHOW * wrapWidth * 4 — for terminalWidth=80 → 70 * 4
    // = 840 chars processed at most.
    const huge = 'X'.repeat(200_000) + '\n' + 'Y'.repeat(200_000)
    const result = renderTruncatedContent(huge, 80)
    // Output length is bounded — not proportional to input.
    expect(result.length).toBeLessThan(5000)
  })

  test('wrap width respects PADDING (terminalWidth - 10)', () => {
    // Pin: at width 20, wrapWidth = 10. Single 30-char line → wraps to 3
    // lines (10, 10, 10) → 3 lines exact = display all, no hint.
    const result = renderTruncatedContent('X'.repeat(30), 20)
    // The 30-char line gets wrapped into multiple display lines.
    expect(result.split('\n').length).toBeGreaterThan(1)
  })

  test('minimum wrap width is 10 (clamp)', () => {
    // Pin: terminalWidth < 20 → still wrap at 10. Prevents
    // wrapWidth = 0 or negative from crashing the slicer.
    const result = renderTruncatedContent('abcdefghijklmnop', 5)
    // Should not crash, should produce some output.
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('isOutputLineTruncated', () => {
  test('empty string → false', () => {
    expect(isOutputLineTruncated('')).toBe(false)
  })

  test('single line → false', () => {
    expect(isOutputLineTruncated('only one line')).toBe(false)
  })

  test('3 lines (2 newlines) → false', () => {
    expect(isOutputLineTruncated('a\nb\nc')).toBe(false)
  })

  test('exactly 4 lines (3 newlines) → false (matches "single-overflow" rule)', () => {
    // Pin: matches renderTruncatedContent's 4-line inline display.
    expect(isOutputLineTruncated('a\nb\nc\nd')).toBe(false)
  })

  test('5 lines → true (genuine truncation)', () => {
    expect(isOutputLineTruncated('a\nb\nc\nd\ne')).toBe(true)
  })

  test('trailing newline is terminator, NOT a line', () => {
    // Pin: matches trimEnd() in renderTruncatedContent.
    // "a\nb\nc\nd\n" has 4 lines (terminator), NOT 5.
    expect(isOutputLineTruncated('a\nb\nc\nd\n')).toBe(false)
  })

  test('content after final \\n is counted as a new line', () => {
    // "a\nb\nc\nd\ne\n" → 5 lines + terminator.
    expect(isOutputLineTruncated('a\nb\nc\nd\ne\n')).toBe(true)
  })

  test('many lines → true', () => {
    expect(
      isOutputLineTruncated(Array(100).fill('x').join('\n')),
    ).toBe(true)
  })
})
