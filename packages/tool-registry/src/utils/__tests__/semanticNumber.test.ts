import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { semanticNumber } from '../semanticNumber.js'

describe('semanticNumber — basic number parsing', () => {
  test('accepts numbers', () => {
    expect(semanticNumber().parse(42)).toBe(42)
    expect(semanticNumber().parse(0)).toBe(0)
    expect(semanticNumber().parse(-5)).toBe(-5)
    expect(semanticNumber().parse(3.14)).toBeCloseTo(3.14)
  })

  test('coerces "30" → 30', () => {
    expect(semanticNumber().parse('30')).toBe(30)
  })

  test('coerces "-5" → -5', () => {
    expect(semanticNumber().parse('-5')).toBe(-5)
  })

  test('coerces "3.14" → 3.14', () => {
    expect(semanticNumber().parse('3.14')).toBeCloseTo(3.14)
  })

  test('coerces "0" → 0', () => {
    expect(semanticNumber().parse('0')).toBe(0)
  })
})

describe('semanticNumber — rejects (the whole point — z.coerce.number would accept these)', () => {
  test('rejects empty string (z.coerce.number → 0)', () => {
    // Critical: empty string is a model bug, not a valid number. The
    // value passes through preprocess unchanged, then inner z.number()
    // rejects it.
    expect(() => semanticNumber().parse('')).toThrow()
  })

  test('rejects whitespace-only string', () => {
    expect(() => semanticNumber().parse('   ')).toThrow()
  })

  test('rejects null (z.coerce.number → 0)', () => {
    expect(() => semanticNumber().parse(null)).toThrow()
  })

  test('rejects boolean (z.coerce.number → 0/1)', () => {
    expect(() => semanticNumber().parse(true)).toThrow()
    expect(() => semanticNumber().parse(false)).toThrow()
  })

  test('rejects "abc" (non-numeric string)', () => {
    expect(() => semanticNumber().parse('abc')).toThrow()
  })

  test('rejects "1e5" (scientific notation NOT in regex)', () => {
    // Regex is /^-?\d+(\.\d+)?$/ — scientific notation is OUT of
    // contract. Catches a refactor that "extends" the regex to be
    // too permissive.
    expect(() => semanticNumber().parse('1e5')).toThrow()
  })

  test('rejects "0x10" (hex string)', () => {
    expect(() => semanticNumber().parse('0x10')).toThrow()
  })

  test('rejects "1.2.3" (multiple dots)', () => {
    expect(() => semanticNumber().parse('1.2.3')).toThrow()
  })

  test('rejects ".5" (leading dot, no integer part)', () => {
    // Regex requires \d+ before optional .\d+ — no leading-dot decimals.
    expect(() => semanticNumber().parse('.5')).toThrow()
  })

  test('rejects "5." (trailing dot, no fractional part)', () => {
    expect(() => semanticNumber().parse('5.')).toThrow()
  })

  test('rejects "  30  " (whitespace-padded)', () => {
    // The regex doesn't allow surrounding whitespace.
    expect(() => semanticNumber().parse('  30  ')).toThrow()
  })

  test('rejects "+5" (explicit positive sign)', () => {
    // Regex only allows -?, not +?. Catches refactor "improvements"
    // that accept +N (which is a different model output pattern).
    expect(() => semanticNumber().parse('+5')).toThrow()
  })

  test('rejects "Infinity" string', () => {
    expect(() => semanticNumber().parse('Infinity')).toThrow()
  })

  test('rejects "NaN" string', () => {
    expect(() => semanticNumber().parse('NaN')).toThrow()
  })
})

describe('semanticNumber — with optional inner', () => {
  test('undefined → undefined when optional', () => {
    expect(
      semanticNumber(z.number().optional()).parse(undefined),
    ).toBeUndefined()
  })

  test('"30" still coerces with optional inner', () => {
    expect(semanticNumber(z.number().optional()).parse('30')).toBe(30)
  })
})

describe('semanticNumber — with default', () => {
  test('default value applied when input is undefined', () => {
    expect(semanticNumber(z.number().default(99)).parse(undefined)).toBe(99)
  })

  test('"30" still coerces over default', () => {
    expect(semanticNumber(z.number().default(99)).parse('30')).toBe(30)
  })
})

describe('semanticNumber — schema shape', () => {
  test('JSON Schema reports type=number', () => {
    // String tolerance is invisible — the model is told to emit numbers.
    const jsonSchema = z.toJSONSchema(semanticNumber()) as {
      type?: string
    }
    expect(jsonSchema.type).toBe('number')
  })
})
