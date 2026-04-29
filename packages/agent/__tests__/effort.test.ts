import { describe, expect, test } from 'bun:test'
import {
  EFFORT_LEVELS,
  convertEffortValueToLevel,
  isEffortLevel,
  isValidNumericEffort,
  parseEffortValue,
  toPersistableEffort,
} from '../effort.js'

describe('EFFORT_LEVELS', () => {
  test('contains canonical 5-tier order low → max', () => {
    expect([...EFFORT_LEVELS]).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })
})

describe('isEffortLevel', () => {
  test('all 5 canonical levels pass', () => {
    for (const lvl of EFFORT_LEVELS) {
      expect(isEffortLevel(lvl)).toBe(true)
    }
  })
  test('rejects unknown strings', () => {
    expect(isEffortLevel('foo')).toBe(false)
    expect(isEffortLevel('')).toBe(false)
    expect(isEffortLevel('LOW')).toBe(false) // case-sensitive
    expect(isEffortLevel('best')).toBe(false)
  })
})

describe('isValidNumericEffort', () => {
  test('integer accepted', () => {
    expect(isValidNumericEffort(0)).toBe(true)
    expect(isValidNumericEffort(50)).toBe(true)
    expect(isValidNumericEffort(100)).toBe(true)
    expect(isValidNumericEffort(-5)).toBe(true) // contract: any integer
  })
  test('non-integer rejected', () => {
    expect(isValidNumericEffort(50.5)).toBe(false)
    expect(isValidNumericEffort(NaN)).toBe(false)
    expect(isValidNumericEffort(Infinity)).toBe(false)
  })
})

describe('parseEffortValue', () => {
  test('null/undefined/empty → undefined', () => {
    expect(parseEffortValue(undefined)).toBeUndefined()
    expect(parseEffortValue(null)).toBeUndefined()
    expect(parseEffortValue('')).toBeUndefined()
  })
  test('canonical level strings pass through', () => {
    expect(parseEffortValue('low')).toBe('low')
    expect(parseEffortValue('medium')).toBe('medium')
    expect(parseEffortValue('high')).toBe('high')
    expect(parseEffortValue('xhigh')).toBe('xhigh')
    expect(parseEffortValue('max')).toBe('max')
  })
  test('uppercase coerced to lowercase', () => {
    expect(parseEffortValue('LOW')).toBe('low')
    expect(parseEffortValue('MAX')).toBe('max')
  })
  test('integer numbers pass through', () => {
    expect(parseEffortValue(50)).toBe(50)
    expect(parseEffortValue(0)).toBe(0)
    expect(parseEffortValue(100)).toBe(100)
  })
  test('numeric strings parse to integer', () => {
    expect(parseEffortValue('50')).toBe(50)
    expect(parseEffortValue('100')).toBe(100)
  })
  test('non-integer numbers fall through to parseInt (truncate to integer)', () => {
    // Non-integer fails isValidNumericEffort, then String(50.5)→'50.5'→
    // parseInt('50.5', 10) = 50 → passes integer check
    expect(parseEffortValue(50.5)).toBe(50)
  })
  test('garbage rejected', () => {
    expect(parseEffortValue('foo')).toBeUndefined()
    expect(parseEffortValue({})).toBeUndefined()
    expect(parseEffortValue([])).toBeUndefined()
  })
})

describe('toPersistableEffort', () => {
  test('only string levels are persistable', () => {
    expect(toPersistableEffort('low')).toBe('low')
    expect(toPersistableEffort('medium')).toBe('medium')
    expect(toPersistableEffort('high')).toBe('high')
    expect(toPersistableEffort('xhigh')).toBe('xhigh')
    expect(toPersistableEffort('max')).toBe('max')
  })
  test('numeric values are NOT persistable (model-default-only)', () => {
    expect(toPersistableEffort(50)).toBeUndefined()
    expect(toPersistableEffort(0)).toBeUndefined()
    expect(toPersistableEffort(100)).toBeUndefined()
  })
  test('undefined → undefined', () => {
    expect(toPersistableEffort(undefined)).toBeUndefined()
  })
})

describe('convertEffortValueToLevel — string passthrough', () => {
  test('valid level passes through', () => {
    expect(convertEffortValueToLevel('low')).toBe('low')
    expect(convertEffortValueToLevel('xhigh')).toBe('xhigh')
  })
  test('invalid level falls back to high', () => {
    expect(convertEffortValueToLevel('garbage' as never)).toBe('high')
  })
})

describe('convertEffortValueToLevel — numeric (ant only)', () => {
  test('without USER_TYPE=ant, numeric → high default', () => {
    const original = process.env.USER_TYPE
    delete process.env.USER_TYPE
    try {
      expect(convertEffortValueToLevel(50)).toBe('high')
    } finally {
      if (original !== undefined) process.env.USER_TYPE = original
    }
  })
  test('with USER_TYPE=ant, numeric maps to tiers', () => {
    const original = process.env.USER_TYPE
    process.env.USER_TYPE = 'ant'
    try {
      // 5-tier: ≤50 low, ≤85 medium, ≤95 high, ≤100 xhigh, >100 max
      expect(convertEffortValueToLevel(0)).toBe('low')
      expect(convertEffortValueToLevel(50)).toBe('low')
      expect(convertEffortValueToLevel(51)).toBe('medium')
      expect(convertEffortValueToLevel(85)).toBe('medium')
      expect(convertEffortValueToLevel(86)).toBe('high')
      expect(convertEffortValueToLevel(95)).toBe('high')
      expect(convertEffortValueToLevel(96)).toBe('xhigh')
      expect(convertEffortValueToLevel(100)).toBe('xhigh')
      expect(convertEffortValueToLevel(101)).toBe('max')
      expect(convertEffortValueToLevel(150)).toBe('max')
    } finally {
      if (original !== undefined) process.env.USER_TYPE = original
      else delete process.env.USER_TYPE
    }
  })
})
