/**
 * Tests for the second tranche of pure helpers in mcp-runtime/utils.ts:
 *   - isMcpTool / isMcpCommand: prefix-based + isMcp flag detection
 *   - getScopeLabel: scope → human-readable label
 *   - ensureConfigScope / ensureTransport: input validators (throw on bad)
 *   - parseHeaders: "K: V" array → Record
 *   - getLoggingSafeMcpBaseUrl: strip query string + trailing slash for analytics
 *
 * Used by /mcp UI, MCP tool dispatch, telemetry. Wrong scope label =
 * misleading user about config provenance; wrong header parsing =
 * malformed Authorization headers; wrong base URL extraction =
 * access tokens leaked to logs.
 */
import { describe, expect, test } from 'bun:test'
import {
  ensureConfigScope,
  ensureTransport,
  getLoggingSafeMcpBaseUrl,
  getScopeLabel,
  isMcpCommand,
  isMcpTool,
  parseHeaders,
} from '../utils.js'

describe('isMcpTool', () => {
  test('mcp__server__name → true', () => {
    expect(isMcpTool({ name: 'mcp__github__list' } as never)).toBe(true)
  })

  test('isMcp flag (no prefix) → true', () => {
    expect(isMcpTool({ name: 'something', isMcp: true } as never)).toBe(true)
  })

  test('non-MCP tool → false', () => {
    expect(isMcpTool({ name: 'Bash' } as never)).toBe(false)
  })

  test('empty name without isMcp → false', () => {
    expect(isMcpTool({ name: '' } as never)).toBe(false)
  })

  test('undefined name → false (no startsWith on undefined)', () => {
    expect(isMcpTool({ name: undefined } as never)).toBe(false)
  })

  test('mcp__ prefix alone (no server segment) is still considered MCP', () => {
    // The function only checks .startsWith('mcp__'), so even a
    // malformed "mcp__" returns true. Lock the loose behavior.
    expect(isMcpTool({ name: 'mcp__' } as never)).toBe(true)
  })

  test('isMcp=false but with mcp__ prefix → still true (prefix wins)', () => {
    expect(
      isMcpTool({ name: 'mcp__a__b', isMcp: false } as never),
    ).toBe(true)
  })
})

describe('isMcpCommand', () => {
  test('mcp__server__name → true', () => {
    expect(isMcpCommand({ name: 'mcp__github__list' } as never)).toBe(true)
  })

  test('isMcp flag without mcp__ prefix → true', () => {
    expect(isMcpCommand({ name: 'github:list', isMcp: true } as never)).toBe(
      true,
    )
  })

  test('non-MCP command (no prefix, no flag) → false', () => {
    expect(isMcpCommand({ name: 'compact' } as never)).toBe(false)
  })

  test('falsy name with isMcp flag → still true', () => {
    expect(isMcpCommand({ name: '', isMcp: true } as never)).toBe(true)
  })
})

describe('getScopeLabel', () => {
  test('local', () => {
    expect(getScopeLabel('local' as never)).toMatch(/Local/)
    expect(getScopeLabel('local' as never)).toMatch(/private to you/)
  })

  test('project', () => {
    expect(getScopeLabel('project' as never)).toMatch(/Project/)
    expect(getScopeLabel('project' as never)).toMatch(/.mcp.json/)
  })

  test('user', () => {
    expect(getScopeLabel('user' as never)).toMatch(/User/)
    expect(getScopeLabel('user' as never)).toMatch(/all your projects/)
  })

  test('dynamic', () => {
    expect(getScopeLabel('dynamic' as never)).toMatch(/Dynamic/)
    expect(getScopeLabel('dynamic' as never)).toMatch(/command line/)
  })

  test('enterprise', () => {
    expect(getScopeLabel('enterprise' as never)).toMatch(/Enterprise/)
    expect(getScopeLabel('enterprise' as never)).toMatch(/organization/i)
  })

  test('claudeai', () => {
    expect(getScopeLabel('claudeai' as never)).toMatch(/claude.ai/i)
  })

  test('unknown scope falls through to the raw value', () => {
    // The default arm returns the input string. Documented passthrough.
    expect(getScopeLabel('weird-future-scope' as never)).toBe(
      'weird-future-scope',
    )
  })
})

describe('ensureConfigScope', () => {
  test('undefined → "local" (default)', () => {
    expect(ensureConfigScope(undefined)).toBe('local')
  })

  test('empty string → "local" (falsy default)', () => {
    expect(ensureConfigScope('')).toBe('local')
  })

  test.each(['local', 'project', 'user', 'dynamic'])(
    'valid scope %s passes through',
    scope => {
      expect(ensureConfigScope(scope)).toBe(scope)
    },
  )

  test('invalid scope throws with helpful message', () => {
    expect(() => ensureConfigScope('bogus')).toThrow(/Invalid scope: bogus/)
    expect(() => ensureConfigScope('bogus')).toThrow(/Must be one of/)
  })
})

describe('ensureTransport', () => {
  test('undefined → "stdio" (default)', () => {
    expect(ensureTransport(undefined)).toBe('stdio')
  })

  test('empty string → "stdio"', () => {
    expect(ensureTransport('')).toBe('stdio')
  })

  test.each(['stdio', 'sse', 'http'])('valid transport %s passes', t => {
    expect(ensureTransport(t)).toBe(t)
  })

  test('invalid transport throws', () => {
    expect(() => ensureTransport('udp')).toThrow(/Invalid transport type: udp/)
    expect(() => ensureTransport('udp')).toThrow(/stdio.*sse.*http/)
  })

  test('case-sensitive (uppercase rejected)', () => {
    expect(() => ensureTransport('STDIO')).toThrow(/Invalid transport/)
  })
})

describe('parseHeaders', () => {
  test('empty array → empty record', () => {
    expect(parseHeaders([])).toEqual({})
  })

  test('single header parses', () => {
    expect(parseHeaders(['Authorization: Bearer abc'])).toEqual({
      Authorization: 'Bearer abc',
    })
  })

  test('multiple headers parsed independently', () => {
    expect(
      parseHeaders([
        'Content-Type: application/json',
        'X-Foo: bar',
        'Accept: */*',
      ]),
    ).toEqual({
      'Content-Type': 'application/json',
      'X-Foo': 'bar',
      Accept: '*/*',
    })
  })

  test('value with extra colons preserved', () => {
    // Only the FIRST colon is used as delimiter (indexOf:0).
    expect(parseHeaders(['Date: 2026-04-30T12:00:00Z'])).toEqual({
      Date: '2026-04-30T12:00:00Z',
    })
  })

  test('whitespace around key and value trimmed', () => {
    expect(parseHeaders(['  X-Trim  :  value  '])).toEqual({
      'X-Trim': 'value',
    })
  })

  test('throws on header without colon', () => {
    expect(() => parseHeaders(['NoColonHere'])).toThrow(
      /Invalid header format/,
    )
  })

  test('throws on empty key', () => {
    expect(() => parseHeaders([': value'])).toThrow(
      /Header name cannot be empty/,
    )
  })

  test('empty value preserved (k: with empty value is valid)', () => {
    expect(parseHeaders(['X-Empty:'])).toEqual({ 'X-Empty': '' })
  })

  test('duplicate keys: last write wins', () => {
    expect(parseHeaders(['X: 1', 'X: 2'])).toEqual({ X: '2' })
  })
})

describe('getLoggingSafeMcpBaseUrl', () => {
  test('http URL: returns origin+path', () => {
    expect(
      getLoggingSafeMcpBaseUrl({ url: 'https://api.example.com/mcp' } as never),
    ).toBe('https://api.example.com/mcp')
  })

  test('strips query string (might contain access tokens)', () => {
    // Documented security purpose.
    expect(
      getLoggingSafeMcpBaseUrl({
        url: 'https://api.example.com/mcp?token=secret&id=42',
      } as never),
    ).toBe('https://api.example.com/mcp')
  })

  test('strips trailing slash for normalization', () => {
    expect(
      getLoggingSafeMcpBaseUrl({ url: 'https://api.example.com/' } as never),
    ).toBe('https://api.example.com')
  })

  test('config without url field → undefined (e.g., stdio)', () => {
    expect(
      getLoggingSafeMcpBaseUrl({ command: 'node', args: ['x'] } as never),
    ).toBeUndefined()
  })

  test('non-string url → undefined', () => {
    expect(
      getLoggingSafeMcpBaseUrl({ url: 123 as unknown as string } as never),
    ).toBeUndefined()
  })

  test('invalid url string → undefined (URL constructor throws)', () => {
    expect(
      getLoggingSafeMcpBaseUrl({ url: 'not a url' } as never),
    ).toBeUndefined()
  })

  test('preserves port + auth-userinfo (those are not query string)', () => {
    // The function only strips `search`, leaving auth and ports alone.
    // Lock that behavior — analytics event sees the full origin shape.
    const result = getLoggingSafeMcpBaseUrl({
      url: 'https://user:pass@api.example.com:8443/path',
    } as never)
    expect(result).toContain('api.example.com:8443')
    expect(result).toContain('/path')
  })
})
