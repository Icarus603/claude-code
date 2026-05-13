import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

import {
  IMAGE_TOKEN_ESTIMATE,
  MCP_TOKEN_COUNT_THRESHOLD_FACTOR,
  getContentSizeEstimate,
  getMaxMcpOutputTokens,
} from '../mcpValidation.ts'

/**
 * Pin invariants for MCP output validation — the gate that decides when
 * to truncate MCP tool output before sending to the model.
 *
 * Critical numerical constants worth pinning:
 *  1. MCP_TOKEN_COUNT_THRESHOLD_FACTOR = 0.5 — the rough-estimate must
 *     exceed 50% of cap before we count tokens precisely (precise counting
 *     calls into the model; we don't pay that cost for small responses).
 *  2. IMAGE_TOKEN_ESTIMATE = 1600 — image block token approximation.
 *  3. DEFAULT_MAX_MCP_OUTPUT_TOKENS = 25_000 — pinned via getMaxMcpOutputTokens
 *     fallback path.
 *  4. Char budget = tokens * 4 (industry rule-of-thumb).
 *  5. Env var precedence: MAX_MCP_OUTPUT_TOKENS env var > tengu_satin_quoll
 *     GrowthBook `mcp_tool` key > default.
 */
describe('mcpValidation', () => {
  describe('Constants', () => {
    test('MCP_TOKEN_COUNT_THRESHOLD_FACTOR = 0.5 (precise-count above 50% cap)', () => {
      expect(MCP_TOKEN_COUNT_THRESHOLD_FACTOR).toBe(0.5)
    })

    test('IMAGE_TOKEN_ESTIMATE = 1600 (Claude image token estimate)', () => {
      expect(IMAGE_TOKEN_ESTIMATE).toBe(1600)
    })
  })

  describe('getMaxMcpOutputTokens — precedence', () => {
    const orig = process.env.MAX_MCP_OUTPUT_TOKENS

    beforeEach(() => {
      delete process.env.MAX_MCP_OUTPUT_TOKENS
    })

    afterEach(() => {
      if (orig !== undefined) {
        process.env.MAX_MCP_OUTPUT_TOKENS = orig
      } else {
        delete process.env.MAX_MCP_OUTPUT_TOKENS
      }
    })

    test('no env, no flag → default 25_000', () => {
      // Test env: GrowthBook returns {} by default (no flag pulled).
      expect(getMaxMcpOutputTokens()).toBe(25_000)
    })

    test('valid positive env value wins over default', () => {
      process.env.MAX_MCP_OUTPUT_TOKENS = '50000'
      expect(getMaxMcpOutputTokens()).toBe(50_000)
    })

    test('env value of 0 → fall through (NOT cap at 0)', () => {
      // Pin: zero is treated as "invalid" — a cap of 0 tokens would
      // truncate every MCP call.
      process.env.MAX_MCP_OUTPUT_TOKENS = '0'
      expect(getMaxMcpOutputTokens()).toBe(25_000)
    })

    test('env value negative → fall through to default', () => {
      // Pin: negative tokens nonsense — must fall through, not propagate.
      process.env.MAX_MCP_OUTPUT_TOKENS = '-100'
      expect(getMaxMcpOutputTokens()).toBe(25_000)
    })

    test('env value non-numeric → fall through to default', () => {
      process.env.MAX_MCP_OUTPUT_TOKENS = 'abc'
      expect(getMaxMcpOutputTokens()).toBe(25_000)
    })

    test('env value with whitespace/trailing → parseInt grabs leading int', () => {
      process.env.MAX_MCP_OUTPUT_TOKENS = '100 trailing'
      expect(getMaxMcpOutputTokens()).toBe(100)
    })
  })

  describe('getContentSizeEstimate', () => {
    test('undefined → 0', () => {
      expect(getContentSizeEstimate(undefined)).toBe(0)
    })

    test('empty string → 0', () => {
      expect(getContentSizeEstimate('')).toBe(0)
    })

    test('string → roughTokenCountEstimation result', () => {
      // Pin: short string yields proportionally small estimate.
      const small = getContentSizeEstimate('hello world')
      const big = getContentSizeEstimate('hello world'.repeat(100))
      expect(big).toBeGreaterThan(small)
    })

    test('empty array → 0', () => {
      expect(getContentSizeEstimate([])).toBe(0)
    })

    test('single image block → IMAGE_TOKEN_ESTIMATE (1600)', () => {
      const result = getContentSizeEstimate([
        {
          type: 'image' as const,
          source: { type: 'base64', media_type: 'image/png', data: 'xyz' },
        },
      ])
      expect(result).toBe(IMAGE_TOKEN_ESTIMATE)
    })

    test('multiple images sum: N * IMAGE_TOKEN_ESTIMATE', () => {
      const result = getContentSizeEstimate([
        {
          type: 'image' as const,
          source: { type: 'base64', media_type: 'image/png', data: 'xyz' },
        },
        {
          type: 'image' as const,
          source: { type: 'base64', media_type: 'image/png', data: 'xyz' },
        },
        {
          type: 'image' as const,
          source: { type: 'base64', media_type: 'image/png', data: 'xyz' },
        },
      ])
      expect(result).toBe(IMAGE_TOKEN_ESTIMATE * 3)
    })

    test('text + image mixed — both contribute', () => {
      const textOnly = getContentSizeEstimate([
        { type: 'text' as const, text: 'hello world' },
      ])
      const mixed = getContentSizeEstimate([
        { type: 'text' as const, text: 'hello world' },
        {
          type: 'image' as const,
          source: { type: 'base64', media_type: 'image/png', data: 'xyz' },
        },
      ])
      expect(mixed).toBe(textOnly + IMAGE_TOKEN_ESTIMATE)
    })

    test('unknown block types contribute 0 (silent skip)', () => {
      // Pin: unknown content block doesn't crash; it's ignored.
      const result = getContentSizeEstimate([
        { type: 'tool_use' as never, id: 'x', name: 'y', input: {} } as never,
      ])
      expect(result).toBe(0)
    })
  })
})

describe('mcpValidation — source pins', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'mcpValidation.ts'),
    'utf-8',
  )

  test('DEFAULT_MAX_MCP_OUTPUT_TOKENS = 25000 (hardcoded)', () => {
    // Pin: source-level constant — exported value comes via fall-through.
    expect(source).toMatch(/DEFAULT_MAX_MCP_OUTPUT_TOKENS = 25000/)
  })

  test('char budget = tokens * 4 (industry rule of thumb)', () => {
    expect(source).toMatch(
      /getMaxMcpOutputChars\(\): number \{\s*\n?\s*return getMaxMcpOutputTokens\(\) \* 4/,
    )
  })

  test('GrowthBook flag name = "tengu_satin_quoll"', () => {
    // Pin: ant flag name. Renaming silently breaks the override.
    expect(source).toMatch(/'tengu_satin_quoll'/)
  })

  test('GrowthBook reads the "mcp_tool" key (NOT shared with other tools)', () => {
    // Pin: tengu_satin_quoll is a map with multiple keys; mcp_tool is
    // ours. Other keys (bash_tool, etc.) have different semantics.
    expect(source).toMatch(/overrides\?\.\['mcp_tool'\]/)
  })

  test('env precedence: env var → GrowthBook → default (order in source)', () => {
    const fn = source.match(
      /export function getMaxMcpOutputTokens[\s\S]+?\n\}/,
    )?.[0]
    expect(fn).toBeTruthy()
    const envIdx = fn!.indexOf('MAX_MCP_OUTPUT_TOKENS')
    const flagIdx = fn!.indexOf('tengu_satin_quoll')
    const defaultIdx = fn!.indexOf('DEFAULT_MAX_MCP_OUTPUT_TOKENS')
    expect(envIdx).toBeGreaterThan(-1)
    expect(flagIdx).toBeGreaterThan(envIdx)
    expect(defaultIdx).toBeGreaterThan(flagIdx)
  })
})
