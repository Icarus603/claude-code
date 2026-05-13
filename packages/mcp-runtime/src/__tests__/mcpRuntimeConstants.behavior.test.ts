import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

import { isMcpSessionExpiredError } from '../clientRuntime.ts'

/**
 * Pin MCP runtime constants + critical predicates.
 *
 * isMcpSessionExpiredError is load-bearing because session-expired errors
 * trigger silent reconnect (vs surfacing a hard error). A false negative
 * here means users see "404 Not Found" instead of seamless reconnect; a
 * false positive means we reconnect on every 404 (infinite loops on bad
 * URLs).
 */
describe('MCP runtime invariants', () => {
  describe('isMcpSessionExpiredError', () => {
    test('non-404 status → false (regardless of message)', () => {
      const err = Object.assign(new Error('"code":-32001 not found'), { code: 500 })
      expect(isMcpSessionExpiredError(err)).toBe(false)
    })

    test('404 WITH JSON-RPC -32001 code in message → true (compact form)', () => {
      const err = Object.assign(
        new Error('Server returned: {"error":{"code":-32001,"message":"Session not found"}}'),
        { code: 404 },
      )
      expect(isMcpSessionExpiredError(err)).toBe(true)
    })

    test('404 WITH JSON-RPC -32001 code (with space variant) → true', () => {
      // Defensive: pin both spacing variants so a server that pretty-prints
      // JSON doesn't slip through the detection.
      const err = Object.assign(
        new Error('Server returned: {"error":{"code": -32001,"message":"Session not found"}}'),
        { code: 404 },
      )
      expect(isMcpSessionExpiredError(err)).toBe(true)
    })

    test('404 WITHOUT JSON-RPC -32001 → false (generic web 404)', () => {
      // CRITICAL: prevents false reconnect on a typo'd MCP URL where the
      // user gets a generic web-server 404, not an MCP session-expired.
      const err = Object.assign(new Error('Not Found'), { code: 404 })
      expect(isMcpSessionExpiredError(err)).toBe(false)
    })

    test('missing code field → false (defensive)', () => {
      const err = new Error('"code":-32001 something')
      expect(isMcpSessionExpiredError(err)).toBe(false)
    })
  })

  describe('runtime constants', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'clientRuntime.ts'),
      'utf-8',
    )

    test('DEFAULT_MCP_TOOL_TIMEOUT_MS = 100_000_000 (~27.8 hours, effectively infinite)', () => {
      // Pin so a "let's lower the default for safety" refactor doesn't
      // start failing long-running MCP tools mid-execution. MCP tools are
      // often deployment-orchestration / long-poll patterns.
      expect(source).toMatch(
        /const DEFAULT_MCP_TOOL_TIMEOUT_MS = 100_000_000/,
      )
    })

    test('MAX_MCP_DESCRIPTION_LENGTH = 2048 (cap OpenAPI dumps)', () => {
      // OpenAPI-generated MCP servers dump 15-60KB into tool.description.
      // 2KB cap keeps the intent without blowing the context.
      expect(source).toMatch(/const MAX_MCP_DESCRIPTION_LENGTH = 2048/)
    })

    test('MCP_TOOL_TIMEOUT env var override allowed', () => {
      expect(source).toMatch(
        /parseInt\(process\.env\.MCP_TOOL_TIMEOUT \|\| '', 10\)/,
      )
    })
  })
})
