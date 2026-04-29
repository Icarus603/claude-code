/**
 * Tests for openai/convertTools.ts — Anthropic tool schema → OpenAI
 * function-calling schema translation. Critical for OpenAI-compat
 * mode (Ollama, DeepSeek, vLLM).
 *
 * Wrong translation = either tool calls fail with schema-validation
 * errors at the provider, or Anthropic-specific fields (cache_control,
 * defer_loading) leak into OpenAI requests and 400 the call.
 */
import { describe, expect, test } from 'bun:test'
import {
  anthropicToolChoiceToOpenAI,
  anthropicToolsToOpenAI,
} from '../openai/convertTools.js'

describe('anthropicToolsToOpenAI — basic translation', () => {
  test('basic tool: name + description + input_schema → function shape', () => {
    const result = anthropicToolsToOpenAI([
      {
        name: 'Bash',
        description: 'Run a shell command',
        input_schema: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      } as never,
    ])
    expect(result).toEqual([
      {
        type: 'function',
        function: {
          name: 'Bash',
          description: 'Run a shell command',
          parameters: {
            type: 'object',
            properties: { command: { type: 'string' } },
            required: ['command'],
          },
        },
      },
    ])
  })

  test('missing description → empty string', () => {
    const result = anthropicToolsToOpenAI([
      { name: 'X', input_schema: { type: 'object' } } as never,
    ])
    expect(result[0]?.function.description).toBe('')
  })

  test('missing input_schema → default object schema', () => {
    const result = anthropicToolsToOpenAI([
      { name: 'X', description: 'd' } as never,
    ])
    expect(result[0]?.function.parameters).toEqual({
      type: 'object',
      properties: {},
    })
  })

  test('missing name → empty string (defensive)', () => {
    const result = anthropicToolsToOpenAI([
      { description: 'd', input_schema: { type: 'object' } } as never,
    ])
    expect(result[0]?.function.name).toBe('')
  })

  test('Anthropic-specific fields (cache_control etc.) are stripped', () => {
    // Documented: only name/description/input_schema flow through.
    // cache_control should NOT appear in the OpenAI output.
    const result = anthropicToolsToOpenAI([
      {
        name: 'X',
        description: 'd',
        input_schema: { type: 'object' },
        cache_control: { type: 'ephemeral' },
      } as never,
    ])
    expect(result[0]).not.toHaveProperty('cache_control')
    expect(result[0]?.function).not.toHaveProperty('cache_control')
  })

  test('server-type tools are filtered out (not function calls)', () => {
    // Documented: server tools (web_search, etc.) are NOT translated.
    const result = anthropicToolsToOpenAI([
      { type: 'server', name: 'web_search' } as never,
      { name: 'Bash', description: 'b', input_schema: { type: 'object' } } as never,
    ])
    expect(result).toHaveLength(1)
    expect(result[0]?.function.name).toBe('Bash')
  })
})

describe('anthropicToolsToOpenAI — JSON Schema sanitization', () => {
  test('top-level const → enum [value]', () => {
    const result = anthropicToolsToOpenAI([
      {
        name: 'X',
        description: 'd',
        input_schema: { const: 'fixed-value' },
      } as never,
    ])
    expect(result[0]?.function.parameters).toEqual({ enum: ['fixed-value'] })
    expect(result[0]?.function.parameters).not.toHaveProperty('const')
  })

  test('nested const inside properties is converted', () => {
    const result = anthropicToolsToOpenAI([
      {
        name: 'X',
        description: 'd',
        input_schema: {
          type: 'object',
          properties: {
            mode: { const: 'auto' },
          },
        },
      } as never,
    ])
    const params = result[0]?.function.parameters as { properties: Record<string, unknown> }
    expect(params.properties.mode).toEqual({ enum: ['auto'] })
  })

  test('nested const inside items array is converted', () => {
    const result = anthropicToolsToOpenAI([
      {
        name: 'X',
        description: 'd',
        input_schema: {
          type: 'array',
          items: { const: 42 },
        },
      } as never,
    ])
    const params = result[0]?.function.parameters as { items: unknown }
    expect(params.items).toEqual({ enum: [42] })
  })

  test('nested const inside oneOf array is converted', () => {
    const result = anthropicToolsToOpenAI([
      {
        name: 'X',
        description: 'd',
        input_schema: {
          oneOf: [
            { const: 'a' },
            { const: 'b' },
            { type: 'number' },
          ],
        },
      } as never,
    ])
    const params = result[0]?.function.parameters as { oneOf: unknown[] }
    expect(params.oneOf).toEqual([
      { enum: ['a'] },
      { enum: ['b'] },
      { type: 'number' },
    ])
  })

  test('schema without const is unchanged structurally', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    }
    const result = anthropicToolsToOpenAI([
      { name: 'X', description: 'd', input_schema: schema } as never,
    ])
    expect(result[0]?.function.parameters).toEqual(schema)
  })

  test('deeply nested const (properties → items → const) is converted', () => {
    const result = anthropicToolsToOpenAI([
      {
        name: 'X',
        description: 'd',
        input_schema: {
          type: 'object',
          properties: {
            tags: {
              type: 'array',
              items: { const: 'fixed-tag' },
            },
          },
        },
      } as never,
    ])
    const params = result[0]?.function.parameters as {
      properties: { tags: { items: unknown } }
    }
    expect(params.properties.tags.items).toEqual({ enum: ['fixed-tag'] })
  })
})

describe('anthropicToolChoiceToOpenAI', () => {
  test('{type:"auto"} → "auto"', () => {
    expect(anthropicToolChoiceToOpenAI({ type: 'auto' })).toBe('auto')
  })

  test('{type:"any"} → "required"', () => {
    expect(anthropicToolChoiceToOpenAI({ type: 'any' })).toBe('required')
  })

  test('{type:"tool", name} → {type:"function", function:{name}}', () => {
    expect(anthropicToolChoiceToOpenAI({ type: 'tool', name: 'Bash' })).toEqual({
      type: 'function',
      function: { name: 'Bash' },
    })
  })

  test('undefined → undefined (use provider default)', () => {
    expect(anthropicToolChoiceToOpenAI(undefined)).toBeUndefined()
  })

  test('null → undefined', () => {
    expect(anthropicToolChoiceToOpenAI(null)).toBeUndefined()
  })

  test('non-object (string) → undefined', () => {
    expect(anthropicToolChoiceToOpenAI('auto')).toBeUndefined()
  })

  test('unknown type → undefined (defense in depth)', () => {
    expect(anthropicToolChoiceToOpenAI({ type: 'unknown_thing' })).toBeUndefined()
  })

  test('object missing type field → undefined', () => {
    expect(anthropicToolChoiceToOpenAI({ name: 'Bash' })).toBeUndefined()
  })
})
