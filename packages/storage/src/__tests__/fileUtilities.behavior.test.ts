import { describe, expect, test } from 'bun:test'

import {
  addLineNumbers,
  convertLeadingTabsToSpaces,
} from '../file.ts'

/**
 * Pin file-utility helpers used by the Read tool's content formatting.
 *
 * addLineNumbers is the format the MODEL SEES for every file Read. Drift
 * (e.g. different separator, wrong indentation) breaks the model's
 * ability to reference specific lines via "edit line 42".
 */
describe('file utility helpers', () => {
  describe('addLineNumbers', () => {
    test('empty content → empty string (no spurious "1\\t" line)', () => {
      expect(addLineNumbers({ content: '', startLine: 1 })).toBe('')
    })

    test('startLine 1 single-line content (TAB separator default-on)', () => {
      // The format depends on tengu_compact_line_prefix_killswitch (default OFF
      // → compact TAB mode). Test the default ccb format.
      const result = addLineNumbers({ content: 'hello', startLine: 1 })
      // Either "1\thello" (compact) or "     1→hello" (arrow). Both should
      // be produced by valid configurations.
      expect(result).toMatch(/^(?:1\thello|\s*1→hello)$/)
    })

    test('multi-line: each line gets sequential number from startLine', () => {
      const result = addLineNumbers({
        content: 'first\nsecond\nthird',
        startLine: 10,
      })
      // Compact: "10\tfirst\n11\tsecond\n12\tthird"
      // Arrow:   "    10→first\n    11→second\n    12→third"
      expect(result).toContain('10')
      expect(result).toContain('first')
      expect(result).toContain('11')
      expect(result).toContain('second')
      expect(result).toContain('12')
      expect(result).toContain('third')
    })

    test('CRLF line endings split correctly (Windows files)', () => {
      const result = addLineNumbers({
        content: 'a\r\nb\r\nc',
        startLine: 1,
      })
      // Result should be 3 numbered lines (regex /\r?\n/ splits CRLF)
      const lines = result.split('\n')
      expect(lines.length).toBe(3)
    })

    test('preserves blank lines as numbered entries (consistent line counts)', () => {
      const result = addLineNumbers({
        content: 'first\n\nthird',
        startLine: 1,
      })
      const lines = result.split('\n')
      expect(lines.length).toBe(3)
      // Line 2 should be number "2" with empty content
    })
  })

  describe('convertLeadingTabsToSpaces', () => {
    test('no tabs → return as-is (fast path)', () => {
      const content = 'plain text\nno tabs here'
      expect(convertLeadingTabsToSpaces(content)).toBe(content)
    })

    test('leading single tab → 2 spaces', () => {
      // The pattern is: 1 tab = 2 spaces (NOT 4, NOT 8 — pinned)
      expect(convertLeadingTabsToSpaces('\tfoo')).toBe('  foo')
    })

    test('leading two tabs → 4 spaces (2 spaces per tab)', () => {
      expect(convertLeadingTabsToSpaces('\t\tfoo')).toBe('    foo')
    })

    test('tabs only at line start (not mid-line)', () => {
      // Mid-line tabs are LEFT intact (deliberately — they're part of
      // file content, e.g., TSV data; only leading indentation tabs convert)
      expect(convertLeadingTabsToSpaces('foo\tbar')).toBe('foo\tbar')
    })

    test('multiple lines processed independently', () => {
      const input = '\tline1\n\t\tline2\nline3'
      const expected = '  line1\n    line2\nline3'
      expect(convertLeadingTabsToSpaces(input)).toBe(expected)
    })

    test('empty content → empty string', () => {
      expect(convertLeadingTabsToSpaces('')).toBe('')
    })

    test('does not affect trailing/embedded whitespace', () => {
      expect(convertLeadingTabsToSpaces('foo  \n bar')).toBe('foo  \n bar')
    })
  })
})
