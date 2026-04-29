import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { zodToJsonSchema } from '../zodSchema/zodToJsonSchema.js'

describe('zodToJsonSchema — basic conversion', () => {
  test('z.string() converts to JSON Schema with type=string', () => {
    const result = zodToJsonSchema(z.string())
    expect(result.type).toBe('string')
  })

  test('z.number() converts to type=number', () => {
    const result = zodToJsonSchema(z.number())
    expect(result.type).toBe('number')
  })

  test('z.boolean() converts to type=boolean', () => {
    const result = zodToJsonSchema(z.boolean())
    expect(result.type).toBe('boolean')
  })

  test('z.object({...}) converts to type=object with properties', () => {
    const result = zodToJsonSchema(
      z.object({ name: z.string(), age: z.number() }),
    )
    expect(result.type).toBe('object')
    expect(result.properties).toBeDefined()
  })

  test('z.array(z.string()) converts to type=array with items', () => {
    const result = zodToJsonSchema(z.array(z.string()))
    expect(result.type).toBe('array')
    expect(result.items).toBeDefined()
  })

  test('z.enum returns enum-typed schema', () => {
    const schema = z.enum(['a', 'b', 'c'])
    const result = zodToJsonSchema(schema)
    expect(result.enum).toEqual(['a', 'b', 'c'])
  })
})

describe('zodToJsonSchema — caching by reference identity', () => {
  // Critical performance contract: this function is called on every API
  // request for every tool (~60-250 times per turn). The WeakMap cache
  // makes repeated lookups O(1). If a refactor accidentally drops the
  // cache layer, every API request re-parses every Zod schema —
  // measured ~30ms / call vs <1μs cached.

  test('same schema reference returns the same result reference', () => {
    const schema = z.object({ name: z.string() })
    const a = zodToJsonSchema(schema)
    const b = zodToJsonSchema(schema)
    expect(a).toBe(b) // SAME reference, not just equal
  })

  test('different schema instances are NOT cache-shared (WeakMap key is identity)', () => {
    const schema1 = z.object({ name: z.string() })
    const schema2 = z.object({ name: z.string() }) // structurally same
    const a = zodToJsonSchema(schema1)
    const b = zodToJsonSchema(schema2)
    // Different references → separate cache entries → potentially
    // different result references.
    expect(a).not.toBe(b)
  })

  test('cached result is reference-stable across many calls', () => {
    const schema = z.string()
    const first = zodToJsonSchema(schema)
    for (let i = 0; i < 50; i++) {
      expect(zodToJsonSchema(schema)).toBe(first)
    }
  })

  test('caching is per-schema (not global)', () => {
    const a = z.string()
    const b = z.number()
    const ra = zodToJsonSchema(a)
    const rb = zodToJsonSchema(b)
    expect(ra.type).toBe('string')
    expect(rb.type).toBe('number')
    // Repeat calls preserve per-schema mapping.
    expect(zodToJsonSchema(a).type).toBe('string')
    expect(zodToJsonSchema(b).type).toBe('number')
  })

  test('result is a plain object (Record<string, unknown>)', () => {
    const result = zodToJsonSchema(z.string())
    expect(typeof result).toBe('object')
    expect(result).not.toBeInstanceOf(Array)
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  })
})

describe('zodToJsonSchema — complex schemas', () => {
  test('nested object schemas convert correctly', () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        email: z.string().email(),
      }),
      items: z.array(z.number()),
    })
    const result = zodToJsonSchema(schema)
    expect(result.type).toBe('object')
    expect(result.properties).toBeDefined()
  })

  test('optional fields are reflected in required array', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    })
    const result = zodToJsonSchema(schema)
    expect(result.required).toEqual(['required'])
  })

  test('union types convert without throwing', () => {
    const schema = z.union([z.string(), z.number()])
    expect(() => zodToJsonSchema(schema)).not.toThrow()
  })

  test('literal types preserve the value', () => {
    const schema = z.literal('hello')
    const result = zodToJsonSchema(schema)
    expect(result.const).toBe('hello')
  })
})
