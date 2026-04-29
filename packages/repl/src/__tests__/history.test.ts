import { describe, expect, test } from 'bun:test'
import {
  expandPastedTextRefs,
  formatImageRef,
  formatPastedTextRef,
  getPastedTextRefNumLines,
  parseReferences,
} from '../history.js'

describe('getPastedTextRefNumLines', () => {
  test('zero for single-line text', () => {
    expect(getPastedTextRefNumLines('hello')).toBe(0)
  })
  test('counts \\n delimiters (not lines)', () => {
    // "line1\nline2\nline3" has 2 newlines, so +2 lines
    expect(getPastedTextRefNumLines('line1\nline2\nline3')).toBe(2)
  })
  test('counts \\r\\n as one delimiter', () => {
    expect(getPastedTextRefNumLines('a\r\nb')).toBe(1)
  })
  test('counts \\r alone', () => {
    expect(getPastedTextRefNumLines('a\rb')).toBe(1)
  })
  test('mixed line endings', () => {
    expect(getPastedTextRefNumLines('a\r\nb\nc\rd')).toBe(3)
  })
})

describe('formatPastedTextRef', () => {
  test('omits +lines suffix for zero', () => {
    expect(formatPastedTextRef(1, 0)).toBe('[Pasted text #1]')
  })
  test('includes +lines suffix when nonzero', () => {
    expect(formatPastedTextRef(7, 42)).toBe('[Pasted text #7 +42 lines]')
  })
})

describe('formatImageRef', () => {
  test('formats numeric id', () => {
    expect(formatImageRef(3)).toBe('[Image #3]')
  })
})

describe('parseReferences', () => {
  test('parses pasted-text reference', () => {
    const refs = parseReferences('hello [Pasted text #5 +10 lines] world')
    expect(refs).toHaveLength(1)
    expect(refs[0]?.id).toBe(5)
    expect(refs[0]?.match).toBe('[Pasted text #5 +10 lines]')
    expect(refs[0]?.index).toBe(6)
  })
  test('parses image reference', () => {
    const refs = parseReferences('see [Image #2] here')
    expect(refs).toHaveLength(1)
    expect(refs[0]?.id).toBe(2)
  })
  test('parses truncated-text reference', () => {
    const refs = parseReferences('start [...Truncated text #9] end')
    expect(refs).toHaveLength(1)
    expect(refs[0]?.id).toBe(9)
  })
  test('finds multiple refs in one input', () => {
    const refs = parseReferences('[Pasted text #1] then [Image #2]')
    expect(refs).toHaveLength(2)
    expect(refs.map(r => r.id)).toEqual([1, 2])
  })
  test('filters id 0 (treated as invalid)', () => {
    const refs = parseReferences('[Pasted text #0] [Image #1]')
    // id=0 is filtered out by the .filter() in parseReferences
    expect(refs.map(r => r.id)).toEqual([1])
  })
  test('returns empty for input with no refs', () => {
    expect(parseReferences('plain text')).toEqual([])
  })
})

describe('expandPastedTextRefs', () => {
  test('inlines text content for matching ref', () => {
    const input = 'hello [Pasted text #1 +2 lines] world'
    const out = expandPastedTextRefs(input, {
      1: { id: 1, type: 'text', content: 'a\nb\nc' },
    })
    expect(out).toBe('hello a\nb\nc world')
  })

  test('leaves image refs alone', () => {
    const input = 'see [Image #1] here'
    const out = expandPastedTextRefs(input, {
      1: { id: 1, type: 'image', mediaType: 'image/png' },
    })
    expect(out).toBe('see [Image #1] here')
  })

  test('skips refs with missing pastedContents entry', () => {
    const input = 'see [Pasted text #99] here'
    const out = expandPastedTextRefs(input, {})
    expect(out).toBe('see [Pasted text #99] here')
  })

  test('expands multiple refs in correct positions even when contents shift offsets', () => {
    const input = '[Pasted text #1] middle [Pasted text #2 +0 lines]'
    const out = expandPastedTextRefs(input, {
      1: { id: 1, type: 'text', content: 'AAA' },
      2: { id: 2, type: 'text', content: 'BBB' },
    })
    expect(out).toBe('AAA middle BBB')
  })

  test('content containing a placeholder-looking string is not re-parsed', () => {
    // Critical correctness test: content "[Pasted text #99]" inserted via
    // expansion should NOT be treated as a real ref on subsequent calls.
    // (We test the single-call case: the impl uses original-match offsets,
    // so a placeholder-shaped insertion stays inert within one expansion.)
    const input = '[Pasted text #1]'
    const out = expandPastedTextRefs(input, {
      1: { id: 1, type: 'text', content: '[Pasted text #99]' },
    })
    expect(out).toBe('[Pasted text #99]')
  })
})
