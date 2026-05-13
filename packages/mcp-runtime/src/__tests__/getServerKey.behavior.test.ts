import { describe, expect, test } from 'bun:test'

import { getServerKey } from '../auth.ts'

/**
 * Pin getServerKey behavior. This produces stable per-server cache keys
 * for token storage; changing the hash format would orphan all existing
 * cached tokens (forcing re-auth across the install base).
 *
 * Format: `<serverName>|<sha256-hex-first-16-chars>`. The hash inputs are
 * stable JSON of type + url + headers — so the SAME server config produces
 * the SAME key across runs.
 */
describe('getServerKey (MCP server cache key derivation)', () => {
  test('returns stable key for same config (deterministic hashing)', () => {
    const config = {
      type: 'sse' as const,
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer xxx' },
    }
    const key1 = getServerKey('my-server', config)
    const key2 = getServerKey('my-server', config)
    expect(key1).toBe(key2)
  })

  test('format: <serverName>|<16-hex-chars>', () => {
    const config = {
      type: 'sse' as const,
      url: 'https://example.com/mcp',
    }
    const key = getServerKey('test', config)
    expect(key).toMatch(/^test\|[0-9a-f]{16}$/)
  })

  test('different URLs → different keys (URL is part of identity)', () => {
    const config1 = { type: 'sse' as const, url: 'https://a.com/mcp' }
    const config2 = { type: 'sse' as const, url: 'https://b.com/mcp' }
    expect(getServerKey('s', config1)).not.toBe(getServerKey('s', config2))
  })

  test('different types (sse vs http) → different keys (transport is identity)', () => {
    const sse = { type: 'sse' as const, url: 'https://example.com/mcp' }
    const http = { type: 'http' as const, url: 'https://example.com/mcp' }
    expect(getServerKey('s', sse)).not.toBe(getServerKey('s', http))
  })

  test('different headers → different keys (auth/custom headers part of identity)', () => {
    const config1 = {
      type: 'http' as const,
      url: 'https://example.com/mcp',
      headers: { 'X-Custom': 'v1' },
    }
    const config2 = {
      type: 'http' as const,
      url: 'https://example.com/mcp',
      headers: { 'X-Custom': 'v2' },
    }
    expect(getServerKey('s', config1)).not.toBe(getServerKey('s', config2))
  })

  test('missing headers defaults to empty object (consistent hash regardless of source)', () => {
    const noHeaders = { type: 'http' as const, url: 'https://example.com/mcp' }
    const emptyHeaders = {
      type: 'http' as const,
      url: 'https://example.com/mcp',
      headers: {},
    }
    expect(getServerKey('s', noHeaders)).toBe(getServerKey('s', emptyHeaders))
  })

  test('different server names → different keys (server names not equivalent)', () => {
    const config = { type: 'sse' as const, url: 'https://example.com/mcp' }
    expect(getServerKey('a', config)).not.toBe(getServerKey('b', config))
  })

  test('truncation to 16 chars (not full sha256) — pins to avoid migration risk', () => {
    // If a future refactor changes the truncation length, all cached
    // tokens orphan. 16 hex chars = 64 bits of entropy — plenty for
    // server-key uniqueness with no collision risk in practice.
    const config = { type: 'sse' as const, url: 'https://example.com/mcp' }
    const key = getServerKey('s', config)
    const [, hash] = key.split('|')
    expect(hash!.length).toBe(16)
  })
})
