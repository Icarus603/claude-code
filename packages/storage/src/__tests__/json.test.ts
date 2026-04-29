import { describe, expect, mock, test } from 'bun:test'

// Spread real exports + override only logError so test failures don't
// pollute stdout. See feedback_bun_mock_module_global_scope.md.
const realLogging = await import('@claude-code/local-observability/logging')
mock.module('@claude-code/local-observability/logging', () => ({
  ...realLogging,
  logError: () => {},
}))

const {
  addItemToJSONCArray,
  parseJSONL,
  safeParseJSON,
  safeParseJSONC,
} = await import('../json.js')

describe('safeParseJSON', () => {
  test('parses valid JSON object', () => {
    expect(safeParseJSON('{"a":1}')).toEqual({ a: 1 })
  })
  test('parses primitives', () => {
    expect(safeParseJSON('42')).toBe(42)
    expect(safeParseJSON('"hi"')).toBe('hi')
    expect(safeParseJSON('true')).toBe(true)
    expect(safeParseJSON('null')).toBeNull()
  })
  test('returns null for empty/null/undefined input', () => {
    expect(safeParseJSON(null)).toBeNull()
    expect(safeParseJSON(undefined)).toBeNull()
    expect(safeParseJSON('')).toBeNull()
  })
  test('returns null for malformed JSON', () => {
    expect(safeParseJSON('{not json}')).toBeNull()
    expect(safeParseJSON('}invalid{')).toBeNull()
  })
  test('strips BOM before parsing (PowerShell 5.x compat)', () => {
    expect(safeParseJSON('\uFEFF{"a":1}')).toEqual({ a: 1 })
  })
  test('caches small inputs (returns same parsed value)', () => {
    const json = '{"x":1}'
    expect(safeParseJSON(json)).toEqual(safeParseJSON(json))
  })
  test('handles JSON > 8KB (cache-skip path)', () => {
    const big = '{"data":"' + 'x'.repeat(10000) + '"}'
    const result = safeParseJSON(big) as { data: string }
    expect(result.data.length).toBe(10000)
  })
})

describe('safeParseJSONC (JSON with comments)', () => {
  test('parses standard JSON', () => {
    expect(safeParseJSONC('{"a":1}')).toEqual({ a: 1 })
  })
  test('parses JSON with line comments', () => {
    expect(safeParseJSONC('{ "a": 1 // hello\n }')).toEqual({ a: 1 })
  })
  test('parses JSON with block comments', () => {
    expect(safeParseJSONC('{ /* doc */ "a": 1 }')).toEqual({ a: 1 })
  })
  test('parses JSON with trailing commas', () => {
    expect(safeParseJSONC('{ "a": 1, "b": 2, }')).toEqual({ a: 1, b: 2 })
  })
  test('strips BOM', () => {
    expect(safeParseJSONC('\uFEFF{"a":1}')).toEqual({ a: 1 })
  })
  test('returns null for null/undefined input', () => {
    expect(safeParseJSONC(null)).toBeNull()
    expect(safeParseJSONC(undefined)).toBeNull()
  })
})

describe('parseJSONL', () => {
  test('parses one JSON per line', () => {
    expect(parseJSONL('{"a":1}\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }])
  })
  test('skips empty lines', () => {
    expect(parseJSONL('{"a":1}\n\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }])
  })
  test('skips malformed lines (does not abort)', () => {
    expect(parseJSONL('{"a":1}\nnot json\n{"b":2}')).toEqual([
      { a: 1 },
      { b: 2 },
    ])
  })
  test('handles missing final newline', () => {
    expect(parseJSONL('{"a":1}\n{"b":2}')).toEqual([{ a: 1 }, { b: 2 }])
  })
  test('handles trailing whitespace on lines', () => {
    expect(parseJSONL('{"a":1}   \n')).toEqual([{ a: 1 }])
  })
  test('returns empty for empty input', () => {
    expect(parseJSONL('')).toEqual([])
  })
  // Note: BOM stripping for parseJSONL only applies on the non-Bun fallback
  // path. Bun.JSONL.parseChunk (used here under Bun) does not strip BOM —
  // a leading \uFEFF makes the first line unparseable, so it's skipped
  // (consistent with the "skip malformed lines" contract).
  test('Bun path: leading BOM treated as malformed first line, skipped', () => {
    expect(parseJSONL('\uFEFF{"a":1}\n')).toEqual([])
  })
  test('parses Buffer input', () => {
    const buf = Buffer.from('{"a":1}\n{"b":2}\n', 'utf8')
    expect(parseJSONL(buf)).toEqual([{ a: 1 }, { b: 2 }])
  })
})

describe('addItemToJSONCArray', () => {
  test('adds to empty array', () => {
    const result = addItemToJSONCArray('[]', { foo: 'bar' })
    expect(JSON.parse(result)).toEqual([{ foo: 'bar' }])
  })
  test('appends to non-empty array', () => {
    const result = addItemToJSONCArray('[1, 2]', 3)
    expect(JSON.parse(result)).toEqual([1, 2, 3])
  })
  test('preserves comments when appending (jsonc edit-mode)', () => {
    const input = '[\n  // first item\n  1,\n]'
    const result = addItemToJSONCArray(input, 2)
    expect(result).toContain('// first item')
    expect(result).toContain('1,')
    expect(result).toContain('2,')
    // safeParseJSONC handles trailing commas + comments
    expect(safeParseJSONC(result)).toEqual([1, 2])
  })
  test('creates new array for empty/whitespace input', () => {
    expect(JSON.parse(addItemToJSONCArray('', { x: 1 }))).toEqual([{ x: 1 }])
    expect(JSON.parse(addItemToJSONCArray('  \n', 'val'))).toEqual(['val'])
  })
  test('replaces non-array content', () => {
    const result = addItemToJSONCArray('{"not": "array"}', 'item')
    expect(JSON.parse(result)).toEqual(['item'])
  })
  test('falls back to fresh array on malformed input', () => {
    const result = addItemToJSONCArray('{not parseable}', 'x')
    expect(JSON.parse(result)).toEqual(['x'])
  })
  test('strips BOM from input before parsing', () => {
    const result = addItemToJSONCArray('\uFEFF[1, 2]', 3)
    expect(JSON.parse(result)).toEqual([1, 2, 3])
  })
})
