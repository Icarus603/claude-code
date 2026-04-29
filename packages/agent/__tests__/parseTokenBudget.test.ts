import { describe, expect, test } from 'bun:test'
import {
  findTokenBudgetPositions,
  getBudgetContinuationMessage,
  parseTokenBudget,
} from '../tokenBudget.js'

describe('parseTokenBudget — shorthand at start', () => {
  test('+500k at start of line', () => {
    expect(parseTokenBudget('+500k do the thing')).toBe(500_000)
  })
  test('+1.5m at start of line', () => {
    expect(parseTokenBudget('+1.5m research')).toBe(1_500_000)
  })
  test('+2b at start of line', () => {
    expect(parseTokenBudget('+2b calculate')).toBe(2_000_000_000)
  })
  test('case-insensitive suffix', () => {
    expect(parseTokenBudget('+500K xyz')).toBe(500_000)
    expect(parseTokenBudget('+1M abc')).toBe(1_000_000)
  })
  test('leading whitespace allowed', () => {
    expect(parseTokenBudget('   +500k thing')).toBe(500_000)
  })
})

describe('parseTokenBudget — shorthand at end', () => {
  test('+500k at end (preceded by space)', () => {
    expect(parseTokenBudget('do the thing +500k')).toBe(500_000)
  })
  test('with trailing punctuation', () => {
    expect(parseTokenBudget('do the thing +500k.')).toBe(500_000)
    expect(parseTokenBudget('do the thing +500k!')).toBe(500_000)
    expect(parseTokenBudget('do the thing +500k?')).toBe(500_000)
  })
})

describe('parseTokenBudget — verbose', () => {
  test('use 500k tokens', () => {
    expect(parseTokenBudget('please use 500k tokens')).toBe(500_000)
  })
  test('spend 2m tokens', () => {
    expect(parseTokenBudget('spend 2m tokens on this')).toBe(2_000_000)
  })
  test('singular "token"', () => {
    expect(parseTokenBudget('use 1k token')).toBe(1_000)
  })
  test('case-insensitive verb', () => {
    expect(parseTokenBudget('USE 500k tokens')).toBe(500_000)
  })
  test('matches in middle of sentence', () => {
    expect(parseTokenBudget('hi please spend 1m tokens here')).toBe(1_000_000)
  })
})

describe('parseTokenBudget — non-matches', () => {
  test('returns null for empty', () => {
    expect(parseTokenBudget('')).toBeNull()
  })
  test('returns null for plain prose', () => {
    expect(parseTokenBudget('do something simple')).toBeNull()
  })
  test('does NOT match shorthand without + prefix', () => {
    expect(parseTokenBudget('500k tokens or so')).toBeNull()
  })
  test('does NOT match unknown verb (e.g., "burn N tokens")', () => {
    expect(parseTokenBudget('burn 500k tokens')).toBeNull()
  })
})

describe('findTokenBudgetPositions', () => {
  test('returns empty for non-match', () => {
    expect(findTokenBudgetPositions('hi there')).toEqual([])
  })
  test('returns position of +500k at start', () => {
    const positions = findTokenBudgetPositions('+500k do thing')
    expect(positions.length).toBe(1)
    expect(positions[0]!.start).toBe(0)
  })
  test('returns position of +500k at end', () => {
    const positions = findTokenBudgetPositions('do thing +500k')
    expect(positions.length).toBe(1)
    expect(positions[0]!.start).toBeGreaterThan(0)
  })
  test('does NOT double-count when text is just "+500k"', () => {
    const positions = findTokenBudgetPositions('+500k')
    expect(positions.length).toBe(1)
  })
  test('returns multiple positions for verbose pattern occurrences', () => {
    const positions = findTokenBudgetPositions(
      'first use 1k tokens then spend 2k tokens',
    )
    expect(positions.length).toBe(2)
  })
})

describe('getBudgetContinuationMessage', () => {
  test('formats with locale-aware thousand separators', () => {
    const msg = getBudgetContinuationMessage(50, 250_000, 500_000)
    expect(msg).toContain('50%')
    expect(msg).toContain('250,000')
    expect(msg).toContain('500,000')
    expect(msg).toContain('Keep working')
  })
  test('does NOT instruct summarization', () => {
    const msg = getBudgetContinuationMessage(80, 800_000, 1_000_000)
    expect(msg).toContain('do not summarize')
  })
  test('handles small values', () => {
    const msg = getBudgetContinuationMessage(10, 100, 1000)
    expect(msg).toContain('10%')
    expect(msg).toContain('100')
    expect(msg).toContain('1,000')
  })
})
