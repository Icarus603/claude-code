import { describe, expect, test } from 'bun:test'
import {
  isVimPunctuation,
  isVimWhitespace,
  isVimWordChar,
} from '../Cursor.js'

describe('isVimWordChar', () => {
  test('letters are word chars', () => {
    expect(isVimWordChar('a')).toBe(true)
    expect(isVimWordChar('Z')).toBe(true)
  })
  test('digits are word chars', () => {
    expect(isVimWordChar('0')).toBe(true)
    expect(isVimWordChar('9')).toBe(true)
  })
  test('underscore is a word char', () => {
    expect(isVimWordChar('_')).toBe(true)
  })
  test('CJK letters are word chars (\\p{L})', () => {
    expect(isVimWordChar('中')).toBe(true)
    expect(isVimWordChar('日')).toBe(true)
  })
  test('hyphens / dashes are NOT word chars', () => {
    expect(isVimWordChar('-')).toBe(false)
  })
  test('whitespace is not a word char', () => {
    expect(isVimWordChar(' ')).toBe(false)
    expect(isVimWordChar('\t')).toBe(false)
  })
  test('punctuation is not a word char', () => {
    expect(isVimWordChar('.')).toBe(false)
    expect(isVimWordChar(',')).toBe(false)
    expect(isVimWordChar('(')).toBe(false)
  })
})

describe('isVimWhitespace', () => {
  test('space + tab + newline', () => {
    expect(isVimWhitespace(' ')).toBe(true)
    expect(isVimWhitespace('\t')).toBe(true)
    expect(isVimWhitespace('\n')).toBe(true)
  })
  test('letters and punctuation are not whitespace', () => {
    expect(isVimWhitespace('a')).toBe(false)
    expect(isVimWhitespace('.')).toBe(false)
  })
})

describe('isVimPunctuation', () => {
  test('punctuation chars are punctuation', () => {
    expect(isVimPunctuation('.')).toBe(true)
    expect(isVimPunctuation(',')).toBe(true)
    expect(isVimPunctuation('!')).toBe(true)
    expect(isVimPunctuation('-')).toBe(true)
  })
  test('letters are not punctuation', () => {
    expect(isVimPunctuation('a')).toBe(false)
    expect(isVimPunctuation('Z')).toBe(false)
  })
  test('whitespace is not punctuation', () => {
    expect(isVimPunctuation(' ')).toBe(false)
  })
  test('empty string is not punctuation', () => {
    expect(isVimPunctuation('')).toBe(false)
  })

  test('three classes are mutually exclusive and cover all non-empty chars', () => {
    const samples = ['a', '0', '_', '中', '.', ',', ' ', '\t', '!', '-']
    for (const ch of samples) {
      const classes = [
        isVimWordChar(ch),
        isVimWhitespace(ch),
        isVimPunctuation(ch),
      ]
      const trueCount = classes.filter(Boolean).length
      expect(trueCount).toBe(1)
    }
  })
})
