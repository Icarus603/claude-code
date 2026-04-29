import { describe, expect, test } from 'bun:test'
import {
  getEnumLabel,
  getEnumLabels,
  getEnumValues,
  getFormatHint,
  getMultiSelectLabel,
  getMultiSelectLabels,
  getMultiSelectValues,
  isDateTimeSchema,
  isEnumSchema,
  isMultiSelectEnumSchema,
  validateElicitationInput,
} from '../elicitationValidation.js'

// ─── isEnumSchema / isMultiSelectEnumSchema ────────────────────
describe('isEnumSchema', () => {
  test('detects legacy enum form', () => {
    expect(isEnumSchema({ type: 'string', enum: ['a', 'b'] } as any)).toBe(true)
  })
  test('detects oneOf form', () => {
    expect(
      isEnumSchema({
        type: 'string',
        oneOf: [{ const: 'a', title: 'A' }],
      } as any),
    ).toBe(true)
  })
  test('rejects plain string schema', () => {
    expect(isEnumSchema({ type: 'string' } as any)).toBe(false)
  })
  test('rejects number schema', () => {
    expect(isEnumSchema({ type: 'number' } as any)).toBe(false)
  })
})

describe('isMultiSelectEnumSchema', () => {
  test('detects items.enum form', () => {
    expect(
      isMultiSelectEnumSchema({
        type: 'array',
        items: { enum: ['a', 'b'] },
      } as any),
    ).toBe(true)
  })
  test('detects items.anyOf form', () => {
    expect(
      isMultiSelectEnumSchema({
        type: 'array',
        items: { anyOf: [{ const: 'a', title: 'A' }] },
      } as any),
    ).toBe(true)
  })
  test('rejects array without items.enum', () => {
    expect(
      isMultiSelectEnumSchema({
        type: 'array',
        items: { type: 'string' },
      } as any),
    ).toBe(false)
  })
  test('rejects non-array', () => {
    expect(
      isMultiSelectEnumSchema({ type: 'string', enum: ['a'] } as any),
    ).toBe(false)
  })
})

// ─── enum value/label getters ─────────────────────────────────
describe('getEnumValues / getEnumLabels / getEnumLabel', () => {
  test('legacy enum returns the enum array for both values and labels (no enumNames)', () => {
    const schema = { type: 'string', enum: ['red', 'green'] } as any
    expect(getEnumValues(schema)).toEqual(['red', 'green'])
    expect(getEnumLabels(schema)).toEqual(['red', 'green'])
  })
  test('legacy enum with enumNames uses friendly labels', () => {
    const schema = {
      type: 'string',
      enum: ['r', 'g'],
      enumNames: ['Red', 'Green'],
    } as any
    expect(getEnumLabels(schema)).toEqual(['Red', 'Green'])
  })
  test('oneOf form pulls const/title', () => {
    const schema = {
      type: 'string',
      oneOf: [
        { const: 'r', title: 'Red' },
        { const: 'g', title: 'Green' },
      ],
    } as any
    expect(getEnumValues(schema)).toEqual(['r', 'g'])
    expect(getEnumLabels(schema)).toEqual(['Red', 'Green'])
  })
  test('getEnumLabel maps value → label (oneOf)', () => {
    const schema = {
      type: 'string',
      oneOf: [
        { const: 'r', title: 'Red' },
        { const: 'g', title: 'Green' },
      ],
    } as any
    expect(getEnumLabel(schema, 'g')).toBe('Green')
  })
  test('getEnumLabel falls back to value for unknown', () => {
    const schema = { type: 'string', enum: ['a'] } as any
    expect(getEnumLabel(schema, 'z')).toBe('z')
  })
})

describe('getMultiSelectValues / getMultiSelectLabels / getMultiSelectLabel', () => {
  test('items.enum form', () => {
    const schema = { type: 'array', items: { enum: ['a', 'b'] } } as any
    expect(getMultiSelectValues(schema)).toEqual(['a', 'b'])
    expect(getMultiSelectLabels(schema)).toEqual(['a', 'b'])
  })
  test('items.anyOf form', () => {
    const schema = {
      type: 'array',
      items: {
        anyOf: [
          { const: 'a', title: 'A' },
          { const: 'b', title: 'B' },
        ],
      },
    } as any
    expect(getMultiSelectValues(schema)).toEqual(['a', 'b'])
    expect(getMultiSelectLabels(schema)).toEqual(['A', 'B'])
    expect(getMultiSelectLabel(schema, 'b')).toBe('B')
  })
})

// ─── validateElicitationInput — strings ────────────────────────
describe('validateElicitationInput — strings', () => {
  test('accepts plain string', () => {
    const r = validateElicitationInput('hello', { type: 'string' } as any)
    expect(r).toEqual({ value: 'hello', isValid: true })
  })
  test('enforces minLength', () => {
    const r = validateElicitationInput('a', {
      type: 'string',
      minLength: 3,
    } as any)
    expect(r.isValid).toBe(false)
    expect(r.error).toContain('at least 3')
  })
  test('enforces maxLength', () => {
    const r = validateElicitationInput('abcdef', {
      type: 'string',
      maxLength: 3,
    } as any)
    expect(r.isValid).toBe(false)
    expect(r.error).toContain('at most 3')
  })
  test('email format accepts valid', () => {
    const r = validateElicitationInput('user@example.com', {
      type: 'string',
      format: 'email',
    } as any)
    expect(r.isValid).toBe(true)
  })
  test('email format rejects invalid', () => {
    const r = validateElicitationInput('not-an-email', {
      type: 'string',
      format: 'email',
    } as any)
    expect(r.isValid).toBe(false)
  })
  test('uri format accepts valid', () => {
    const r = validateElicitationInput('https://example.com', {
      type: 'string',
      format: 'uri',
    } as any)
    expect(r.isValid).toBe(true)
  })
  test('date format accepts ISO YYYY-MM-DD', () => {
    const r = validateElicitationInput('2024-03-15', {
      type: 'string',
      format: 'date',
    } as any)
    expect(r.isValid).toBe(true)
  })
  test('date format rejects natural language', () => {
    const r = validateElicitationInput('tomorrow', {
      type: 'string',
      format: 'date',
    } as any)
    expect(r.isValid).toBe(false)
  })
})

describe('validateElicitationInput — enums', () => {
  test('accepts allowed enum value', () => {
    const r = validateElicitationInput('red', {
      type: 'string',
      enum: ['red', 'green'],
    } as any)
    expect(r).toEqual({ value: 'red', isValid: true })
  })
  test('rejects disallowed value', () => {
    const r = validateElicitationInput('blue', {
      type: 'string',
      enum: ['red', 'green'],
    } as any)
    expect(r.isValid).toBe(false)
  })
  test('rejects empty enum (z.never)', () => {
    const r = validateElicitationInput('x', {
      type: 'string',
      enum: [],
    } as any)
    expect(r.isValid).toBe(false)
  })
})

describe('validateElicitationInput — numbers', () => {
  test('accepts numeric string', () => {
    const r = validateElicitationInput('42', { type: 'number' } as any)
    expect(r).toEqual({ value: 42, isValid: true })
  })
  test('integer rejects 3.14', () => {
    const r = validateElicitationInput('3.14', { type: 'integer' } as any)
    expect(r.isValid).toBe(false)
    expect(r.error).toContain('integer')
  })
  test('range enforced (min)', () => {
    const r = validateElicitationInput('0', {
      type: 'number',
      minimum: 1,
      maximum: 10,
    } as any)
    expect(r.isValid).toBe(false)
    // formatNum adds .0 for non-integer schemas with integer-valued bounds
    expect(r.error).toContain('between 1.0 and 10.0')
  })
  test('range enforced (max)', () => {
    const r = validateElicitationInput('20', {
      type: 'number',
      minimum: 1,
      maximum: 10,
    } as any)
    expect(r.isValid).toBe(false)
  })
  test('coerces string → number', () => {
    const r = validateElicitationInput('3.14', { type: 'number' } as any)
    expect(r).toEqual({ value: 3.14, isValid: true })
  })
})

describe('validateElicitationInput — booleans', () => {
  test('accepts truthy strings', () => {
    expect(
      validateElicitationInput('true', { type: 'boolean' } as any).isValid,
    ).toBe(true)
  })
  test('coerces non-empty string to true (zod coerce.boolean behavior)', () => {
    const r = validateElicitationInput('false', { type: 'boolean' } as any)
    // z.coerce.boolean uses Boolean(); 'false' is truthy → true
    expect(r.isValid).toBe(true)
    expect(r.value).toBe(true)
  })
})

// ─── getFormatHint ────────────────────────────────────────────
describe('getFormatHint', () => {
  test('email hint', () => {
    expect(
      getFormatHint({ type: 'string', format: 'email' } as any),
    ).toContain('email')
  })
  test('uri hint', () => {
    expect(getFormatHint({ type: 'string', format: 'uri' } as any)).toContain(
      'URI',
    )
  })
  test('date-time hint', () => {
    expect(
      getFormatHint({ type: 'string', format: 'date-time' } as any),
    ).toContain('date-time')
  })
  test('plain string returns undefined', () => {
    expect(getFormatHint({ type: 'string' } as any)).toBeUndefined()
  })
  test('integer with range (no decimal because integer)', () => {
    const hint = getFormatHint({
      type: 'integer',
      minimum: 1,
      maximum: 10,
    } as any)
    // integer formatNum drops the .0
    expect(hint).toContain('between 1 and 10')
  })
  test('integer min only', () => {
    expect(
      getFormatHint({ type: 'integer', minimum: 0 } as any),
    ).toContain('>= 0')
  })
  test('integer no range gives example', () => {
    expect(getFormatHint({ type: 'integer' } as any)).toContain('42')
  })
  test('number no range gives float example', () => {
    expect(getFormatHint({ type: 'number' } as any)).toContain('3.14')
  })
})

// ─── isDateTimeSchema ─────────────────────────────────────────
describe('isDateTimeSchema', () => {
  test('detects format=date', () => {
    expect(
      isDateTimeSchema({ type: 'string', format: 'date' } as any),
    ).toBe(true)
  })
  test('detects format=date-time', () => {
    expect(
      isDateTimeSchema({ type: 'string', format: 'date-time' } as any),
    ).toBe(true)
  })
  test('rejects format=email', () => {
    expect(
      isDateTimeSchema({ type: 'string', format: 'email' } as any),
    ).toBe(false)
  })
  test('rejects plain string', () => {
    expect(isDateTimeSchema({ type: 'string' } as any)).toBe(false)
  })
})
