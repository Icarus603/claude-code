/**
 * Tests for safeJoinLines + EndTruncatingAccumulator — safety nets for
 * accumulating large shell output / tool result strings without
 * blowing up RSS via O(n²) string concatenation.
 *
 * Wrong size accounting = either silent OOM or premature truncation
 * that drops legitimate output.
 */
import { describe, expect, test } from 'bun:test'
import {
  EndTruncatingAccumulator,
  safeJoinLines,
} from '../utils/stringUtils.js'

describe('safeJoinLines — basic joining', () => {
  test('empty array → empty string', () => {
    expect(safeJoinLines([])).toBe('')
  })

  test('single line → just that line', () => {
    expect(safeJoinLines(['hello'])).toBe('hello')
  })

  test('multiple lines joined with default comma delimiter', () => {
    expect(safeJoinLines(['a', 'b', 'c'])).toBe('a,b,c')
  })

  test('custom delimiter', () => {
    expect(safeJoinLines(['a', 'b', 'c'], ' | ')).toBe('a | b | c')
  })

  test('leading empty string skips delimiter prefix (result-empty check)', () => {
    // Documented quirk: the function skips the delimiter when result===''.
    // First '' makes result still '', so 'b' joins with no leading delim.
    // After 'b', result='b' truthy → trailing '' joins with ','.
    expect(safeJoinLines(['', 'b', ''], ',')).toBe('b,')
  })

  test('newline delimiter', () => {
    expect(safeJoinLines(['line1', 'line2'], '\n')).toBe('line1\nline2')
  })
})

describe('safeJoinLines — truncation on size limit', () => {
  test('within limit: no truncation', () => {
    expect(safeJoinLines(['hello', 'world'], ',', 100)).toBe('hello,world')
  })

  test('over limit: appends [truncated] marker', () => {
    const r = safeJoinLines(['aaaa', 'bbbb', 'cccc'], ',', 8)
    expect(r).toContain('...[truncated]')
  })

  test('exact fit at limit: no truncation', () => {
    // 'aaa' + ',' + 'bbb' = 7 chars, fits in 10.
    expect(safeJoinLines(['aaa', 'bbb'], ',', 10)).toBe('aaa,bbb')
  })

  test('hit limit mid-line: truncated with marker', () => {
    // 5 chars limit: 'aaa,' = 4, then 'bbb' won't fit. truncationMarker
    // is 14 chars, so remainingSpace for partial = 5 - 3 - 1 - 14 = -13.
    // No room for partial line → just appends marker.
    const r = safeJoinLines(['aaa', 'bbb'], ',', 5)
    expect(r).toContain('...[truncated]')
  })

  test('first line exceeds limit alone: marker added', () => {
    const r = safeJoinLines(['x'.repeat(100), 'y'], ',', 5)
    expect(r).toContain('...[truncated]')
    expect(r.length).toBeLessThanOrEqual(110)
  })

  test('exactly at limit: no truncation', () => {
    const r = safeJoinLines(['ab', 'cd'], ',', 5) // 'ab,cd' = 5 chars
    expect(r).toBe('ab,cd')
  })

  test('returns early after first truncation (no more lines processed)', () => {
    // Even if subsequent lines would fit alone, the function returns
    // immediately on first truncation event.
    const r = safeJoinLines(
      ['x'.repeat(100), 'short'],
      ',',
      5,
    )
    expect(r).not.toContain('short')
  })
})

describe('EndTruncatingAccumulator — basic appending', () => {
  test('starts empty', () => {
    const a = new EndTruncatingAccumulator(100)
    expect(a.toString()).toBe('')
    expect(a.length).toBe(0)
    expect(a.truncated).toBe(false)
    expect(a.totalBytes).toBe(0)
  })

  test('append string adds to content', () => {
    const a = new EndTruncatingAccumulator(100)
    a.append('hello')
    expect(a.toString()).toBe('hello')
    expect(a.length).toBe(5)
    expect(a.truncated).toBe(false)
    expect(a.totalBytes).toBe(5)
  })

  test('multiple appends concatenate', () => {
    const a = new EndTruncatingAccumulator(100)
    a.append('hello ')
    a.append('world')
    expect(a.toString()).toBe('hello world')
    expect(a.length).toBe(11)
  })

  test('Buffer input converted to string', () => {
    const a = new EndTruncatingAccumulator(100)
    a.append(Buffer.from('hello', 'utf-8'))
    expect(a.toString()).toBe('hello')
  })
})

describe('EndTruncatingAccumulator — truncation on max size', () => {
  test('exact-fit append: no truncation', () => {
    const a = new EndTruncatingAccumulator(5)
    a.append('hello')
    expect(a.truncated).toBe(false)
    expect(a.toString()).toBe('hello')
  })

  test('over-size append: keeps prefix + appends truncation note', () => {
    const a = new EndTruncatingAccumulator(5)
    a.append('hello world!')
    expect(a.truncated).toBe(true)
    const s = a.toString()
    expect(s.startsWith('hello')).toBe(true)
    expect(s).toContain('output truncated')
    expect(s).toContain('KB removed')
  })

  test('subsequent appends after truncation: ignored', () => {
    const a = new EndTruncatingAccumulator(5)
    a.append('hello!') // 6 chars, exceeds 5
    expect(a.truncated).toBe(true)
    const beforeAppend = a.toString()
    a.append('more data')
    // toString may add a different KB count but content beyond first
    // 5 chars is dropped.
    expect(a.length).toBeLessThanOrEqual(5)
  })

  test('totalBytes tracks ALL bytes received (even truncated)', () => {
    const a = new EndTruncatingAccumulator(5)
    a.append('hello')
    a.append(' world!')
    expect(a.totalBytes).toBe(12) // 5+7
    expect(a.length).toBe(5) // capped
  })

  test('truncation marker reports KB rounded', () => {
    const a = new EndTruncatingAccumulator(10)
    a.append('x'.repeat(2048)) // ~2KB
    const s = a.toString()
    // Check that some KB count is reported.
    expect(s).toMatch(/\d+KB removed/)
  })
})

describe('EndTruncatingAccumulator — clear', () => {
  test('clear resets all state', () => {
    const a = new EndTruncatingAccumulator(5)
    a.append('hello!')
    expect(a.truncated).toBe(true)
    a.clear()
    expect(a.toString()).toBe('')
    expect(a.length).toBe(0)
    expect(a.totalBytes).toBe(0)
    expect(a.truncated).toBe(false)
  })

  test('after clear: append works as fresh start', () => {
    const a = new EndTruncatingAccumulator(5)
    a.append('hello!')
    a.clear()
    a.append('hi')
    expect(a.toString()).toBe('hi')
    expect(a.truncated).toBe(false)
  })
})

describe('EndTruncatingAccumulator — boundary cases', () => {
  test('append at exact size boundary: no truncation', () => {
    const a = new EndTruncatingAccumulator(5)
    a.append('hi')
    a.append('lo!')
    expect(a.toString()).toBe('hilo!')
    expect(a.truncated).toBe(false)
  })

  test('partial fit: appends what fits + sets truncated', () => {
    const a = new EndTruncatingAccumulator(5)
    a.append('hi')
    a.append('the rest is dropped')
    // Should have 'hi' + first 3 chars of 'the rest...' = 'hithe'
    const s = a.toString()
    expect(s.startsWith('hithe')).toBe(true)
    expect(a.truncated).toBe(true)
  })

  test('maxSize=0: every append truncates immediately', () => {
    const a = new EndTruncatingAccumulator(0)
    a.append('anything')
    expect(a.length).toBe(0)
    expect(a.truncated).toBe(true)
  })

  test('empty append: no-op', () => {
    const a = new EndTruncatingAccumulator(5)
    a.append('')
    expect(a.toString()).toBe('')
    expect(a.totalBytes).toBe(0)
  })
})
