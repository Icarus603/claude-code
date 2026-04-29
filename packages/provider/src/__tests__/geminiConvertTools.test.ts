/**
 * Tests for gemini/convertTools.ts — Anthropic → Gemini tool-schema
 * translation.
 *
 * Wrong translation either drops tools (Gemini sees nothing, can't use
 * them) or sends incompatible schemas (Gemini errors and the call fails).
 */
import { describe, expect, test } from 'bun:test'
import {
  anthropicToolChoiceToGemini,
  anthropicToolsToGemini,
} from '../gemini/convertTools.js'

describe('anthropicToolsToGemini — basic translation', () => {
  test('basic tool wrapped in functionDeclarations array', () => {
    const result = anthropicToolsToGemini([
      {
        name: 'Bash',
        description: 'Run a shell command',
        input_schema: {
          type: 'object',
          properties: { command: { type: 'string' } },
        },
      } as never,
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toHaveProperty('functionDeclarations')
    const funcs = result[0]!.functionDeclarations
    expect(funcs).toHaveLength(1)
    expect(funcs[0]?.name).toBe('Bash')
    expect(funcs[0]?.description).toBe('Run a shell command')
    expect(funcs[0]?.parametersJsonSchema).toBeDefined()
  })

  test('multiple tools in one functionDeclarations group', () => {
    const result = anthropicToolsToGemini([
      { name: 'A', description: 'a', input_schema: { type: 'object' } } as never,
      { name: 'B', description: 'b', input_schema: { type: 'object' } } as never,
    ])
    expect(result).toHaveLength(1)
    const funcs = result[0]!.functionDeclarations
    expect(funcs.map(f => f.name)).toEqual(['A', 'B'])
  })

  test('empty tool list → empty array (NOT [{functionDeclarations:[]}])', () => {
    // Documented: returns [] when no functionDeclarations to send,
    // not [{functionDeclarations: []}] (which would 400 Gemini).
    expect(anthropicToolsToGemini([])).toEqual([])
  })

  test('only-server-tools list → empty array', () => {
    // Server-type tools are filtered out. If they're the only tools,
    // we end up with zero functionDeclarations.
    const result = anthropicToolsToGemini([
      { type: 'server', name: 'web_search' } as never,
    ])
    expect(result).toEqual([])
  })

  test('missing description → empty string', () => {
    const result = anthropicToolsToGemini([
      { name: 'X', input_schema: { type: 'object' } } as never,
    ])
    expect(result[0]?.functionDeclarations[0]?.description).toBe('')
  })

  test('missing input_schema → default object schema', () => {
    const result = anthropicToolsToGemini([
      { name: 'X', description: 'd' } as never,
    ])
    const params = result[0]?.functionDeclarations[0]?.parametersJsonSchema
    expect(params).toBeDefined()
  })

  test('Anthropic-specific fields (cache_control) NOT propagated', () => {
    const result = anthropicToolsToGemini([
      {
        name: 'X',
        description: 'd',
        input_schema: { type: 'object' },
        cache_control: { type: 'ephemeral' },
      } as never,
    ])
    const fn = result[0]?.functionDeclarations[0]
    expect(fn).not.toHaveProperty('cache_control')
  })

  test('mixed normal + server tools: server filtered, normal kept', () => {
    const result = anthropicToolsToGemini([
      { type: 'server', name: 'web_search' } as never,
      {
        name: 'Bash',
        description: 'd',
        input_schema: { type: 'object' },
      } as never,
    ])
    expect(result).toHaveLength(1)
    expect(result[0]?.functionDeclarations).toHaveLength(1)
    expect(result[0]?.functionDeclarations[0]?.name).toBe('Bash')
  })
})

describe('anthropicToolChoiceToGemini', () => {
  test('{type:"auto"} → {mode:"AUTO"}', () => {
    expect(anthropicToolChoiceToGemini({ type: 'auto' })).toEqual({
      mode: 'AUTO',
    })
  })

  test('{type:"any"} → {mode:"ANY"}', () => {
    expect(anthropicToolChoiceToGemini({ type: 'any' })).toEqual({
      mode: 'ANY',
    })
  })

  test('{type:"tool", name} → {mode:"ANY", allowedFunctionNames:[name]}', () => {
    expect(
      anthropicToolChoiceToGemini({ type: 'tool', name: 'Bash' }),
    ).toEqual({
      mode: 'ANY',
      allowedFunctionNames: ['Bash'],
    })
  })

  test('{type:"tool"} without name → allowedFunctionNames:undefined', () => {
    // Documented: typeof tc.name === 'string' guard. Missing name
    // falls back to undefined (caller decides whether to send it).
    const result = anthropicToolChoiceToGemini({ type: 'tool' })
    expect(result).toEqual({ mode: 'ANY', allowedFunctionNames: undefined })
  })

  test('undefined → undefined', () => {
    expect(anthropicToolChoiceToGemini(undefined)).toBeUndefined()
  })

  test('null → undefined', () => {
    expect(anthropicToolChoiceToGemini(null)).toBeUndefined()
  })

  test('non-object → undefined', () => {
    expect(anthropicToolChoiceToGemini('auto')).toBeUndefined()
    expect(anthropicToolChoiceToGemini(42)).toBeUndefined()
  })

  test('unknown type → undefined', () => {
    expect(
      anthropicToolChoiceToGemini({ type: 'unknown' }),
    ).toBeUndefined()
  })
})
