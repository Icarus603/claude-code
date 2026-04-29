import { describe, expect, test } from 'bun:test'
import {
  DOCUMENT_EXTENSIONS,
  isPDFExtension,
  parsePDFPageRange,
} from '../pdfUtils.js'

describe('parsePDFPageRange — single page', () => {
  test('"5" → first=5, last=5', () => {
    expect(parsePDFPageRange('5')).toEqual({ firstPage: 5, lastPage: 5 })
  })

  test('"1" (first page) works', () => {
    expect(parsePDFPageRange('1')).toEqual({ firstPage: 1, lastPage: 1 })
  })

  test('"100" (large) works', () => {
    expect(parsePDFPageRange('100')).toEqual({ firstPage: 100, lastPage: 100 })
  })

  test('"0" rejected (page numbers are 1-indexed)', () => {
    expect(parsePDFPageRange('0')).toBeNull()
  })

  test('"-3" rejected (negative)', () => {
    expect(parsePDFPageRange('-3')).toBeNull()
  })

  test('"abc" rejected (non-numeric)', () => {
    expect(parsePDFPageRange('abc')).toBeNull()
  })

  test('empty string rejected', () => {
    expect(parsePDFPageRange('')).toBeNull()
  })

  test('whitespace-only rejected', () => {
    expect(parsePDFPageRange('   ')).toBeNull()
  })
})

describe('parsePDFPageRange — closed range "N-M"', () => {
  test('"1-10" → first=1, last=10', () => {
    expect(parsePDFPageRange('1-10')).toEqual({ firstPage: 1, lastPage: 10 })
  })

  test('"5-5" same number is valid', () => {
    expect(parsePDFPageRange('5-5')).toEqual({ firstPage: 5, lastPage: 5 })
  })

  test('"10-5" inverted range rejected', () => {
    expect(parsePDFPageRange('10-5')).toBeNull()
  })

  test('"0-10" rejected (first must be ≥1)', () => {
    expect(parsePDFPageRange('0-10')).toBeNull()
  })

  test('"1-0" rejected (last must be ≥1)', () => {
    expect(parsePDFPageRange('1-0')).toBeNull()
  })

  test('"abc-10" rejected', () => {
    expect(parsePDFPageRange('abc-10')).toBeNull()
  })

  test('"1-abc" rejected', () => {
    expect(parsePDFPageRange('1-abc')).toBeNull()
  })

  test('"1--5" rejected (double dash, last would be -5)', () => {
    expect(parsePDFPageRange('1--5')).toBeNull()
  })
})

describe('parsePDFPageRange — open-ended "N-"', () => {
  test('"5-" → first=5, last=Infinity', () => {
    expect(parsePDFPageRange('5-')).toEqual({
      firstPage: 5,
      lastPage: Infinity,
    })
  })

  test('"1-" works', () => {
    expect(parsePDFPageRange('1-')).toEqual({
      firstPage: 1,
      lastPage: Infinity,
    })
  })

  test('"-" alone (no first page) rejected', () => {
    expect(parsePDFPageRange('-')).toBeNull()
  })

  test('"abc-" rejected', () => {
    expect(parsePDFPageRange('abc-')).toBeNull()
  })

  test('"0-" rejected (first must be ≥1)', () => {
    expect(parsePDFPageRange('0-')).toBeNull()
  })
})

describe('parsePDFPageRange — whitespace handling', () => {
  test('"  5  " (padded) is trimmed and parses', () => {
    expect(parsePDFPageRange('  5  ')).toEqual({ firstPage: 5, lastPage: 5 })
  })

  test('" 1-10 " (padded range) parses', () => {
    expect(parsePDFPageRange(' 1-10 ')).toEqual({ firstPage: 1, lastPage: 10 })
  })

  test('"1 - 10" (spaces around dash) — parseInt handles trailing spaces only on the first side', () => {
    // parseInt('1 ', 10) = 1, parseInt(' 10', 10) = 10. Will work.
    expect(parsePDFPageRange('1 - 10')).toEqual({ firstPage: 1, lastPage: 10 })
  })
})

describe('isPDFExtension', () => {
  test('"pdf" → true', () => {
    expect(isPDFExtension('pdf')).toBe(true)
  })

  test('".pdf" (with leading dot) → true', () => {
    expect(isPDFExtension('.pdf')).toBe(true)
  })

  test('"PDF" (uppercase) → true (lowercased internally)', () => {
    expect(isPDFExtension('PDF')).toBe(true)
  })

  test('"Pdf" (mixed case) → true', () => {
    expect(isPDFExtension('Pdf')).toBe(true)
  })

  test('".PDF" (uppercase with dot) → true', () => {
    expect(isPDFExtension('.PDF')).toBe(true)
  })

  test('"txt" → false', () => {
    expect(isPDFExtension('txt')).toBe(false)
  })

  test('"docx" → false (only "pdf" is in DOCUMENT_EXTENSIONS)', () => {
    expect(isPDFExtension('docx')).toBe(false)
  })

  test('empty string → false', () => {
    expect(isPDFExtension('')).toBe(false)
  })

  test('"pdf" with trailing chars (e.g., "pdfx") → false', () => {
    // Not a substring match — exact extension only.
    expect(isPDFExtension('pdfx')).toBe(false)
  })

  test('".." (just dots) → false', () => {
    expect(isPDFExtension('..')).toBe(false)
  })
})

describe('DOCUMENT_EXTENSIONS — contract anchor', () => {
  test('exactly contains "pdf"', () => {
    expect(DOCUMENT_EXTENSIONS.has('pdf')).toBe(true)
  })

  test('does NOT contain other office formats (single-format set)', () => {
    expect(DOCUMENT_EXTENSIONS.has('docx')).toBe(false)
    expect(DOCUMENT_EXTENSIONS.has('xlsx')).toBe(false)
    expect(DOCUMENT_EXTENSIONS.has('pptx')).toBe(false)
  })

  test('size is exactly 1 (catches silent additions)', () => {
    expect(DOCUMENT_EXTENSIONS.size).toBe(1)
  })
})
