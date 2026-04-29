import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { semanticBoolean } from '../semanticBoolean.js'

describe('semanticBoolean — basic boolean parsing', () => {
  test('accepts true', () => {
    expect(semanticBoolean().parse(true)).toBe(true)
  })

  test('accepts false', () => {
    expect(semanticBoolean().parse(false)).toBe(false)
  })

  test('accepts string "true" → true', () => {
    expect(semanticBoolean().parse('true')).toBe(true)
  })

  test('accepts string "false" → false', () => {
    expect(semanticBoolean().parse('false')).toBe(false)
  })

  test('rejects other strings (the WHOLE point — z.coerce.boolean would accept everything truthy)', () => {
    // Critical contract: "False" (capital F), "FALSE", "1", "0",
    // "yes", "no" must all be rejected. z.coerce.boolean would
    // accept all non-empty strings as true, masking model bugs.
    expect(() => semanticBoolean().parse('False')).toThrow()
    expect(() => semanticBoolean().parse('FALSE')).toThrow()
    expect(() => semanticBoolean().parse('TRUE')).toThrow()
    expect(() => semanticBoolean().parse('1')).toThrow()
    expect(() => semanticBoolean().parse('0')).toThrow()
    expect(() => semanticBoolean().parse('yes')).toThrow()
    expect(() => semanticBoolean().parse('')).toThrow()
  })

  test('rejects numbers', () => {
    expect(() => semanticBoolean().parse(1)).toThrow()
    expect(() => semanticBoolean().parse(0)).toThrow()
  })

  test('rejects null and undefined', () => {
    expect(() => semanticBoolean().parse(null)).toThrow()
    expect(() => semanticBoolean().parse(undefined)).toThrow()
  })

  test('rejects objects', () => {
    expect(() => semanticBoolean().parse({})).toThrow()
    expect(() => semanticBoolean().parse([])).toThrow()
  })
})

describe('semanticBoolean — with optional inner', () => {
  test('z.boolean().optional() — undefined accepted, returns undefined', () => {
    const schema = semanticBoolean(z.boolean().optional())
    expect(schema.parse(undefined)).toBeUndefined()
  })

  test('z.boolean().optional() — string "true" still coerces', () => {
    const schema = semanticBoolean(z.boolean().optional())
    expect(schema.parse('true')).toBe(true)
  })

  test('z.boolean().optional() — null still rejected (only undefined is OK)', () => {
    const schema = semanticBoolean(z.boolean().optional())
    expect(() => schema.parse(null)).toThrow()
  })
})

describe('semanticBoolean — with default inner', () => {
  test('z.boolean().default(false) — undefined → default value', () => {
    const schema = semanticBoolean(z.boolean().default(false))
    expect(schema.parse(undefined)).toBe(false)
  })

  test('z.boolean().default(true) — undefined → default value', () => {
    const schema = semanticBoolean(z.boolean().default(true))
    expect(schema.parse(undefined)).toBe(true)
  })

  test('z.boolean().default(false) — string "true" still coerces', () => {
    const schema = semanticBoolean(z.boolean().default(false))
    expect(schema.parse('true')).toBe(true)
  })
})

describe('semanticBoolean — schema shape (advertised type to model)', () => {
  test('JSON Schema reports type=boolean (string tolerance is invisible)', () => {
    const jsonSchema = z.toJSONSchema(semanticBoolean()) as {
      type?: string
    }
    // Critical: the model is told this is a boolean. The string
    // tolerance is invisible client-side coercion, NOT advertised.
    // Catches a regression where the schema accidentally widens to
    // a union, which would confuse the model into emitting strings.
    expect(jsonSchema.type).toBe('boolean')
  })
})
