import { describe, expect, test } from 'bun:test'
import {
  buildMcpToolName,
  extractMcpToolDisplayName,
  getMcpDisplayName,
  getMcpPrefix,
  getToolNameForPermissionCheck,
  mcpInfoFromString,
} from '../mcpStringUtils.js'

describe('mcpInfoFromString', () => {
  test('parses mcp__server__tool', () => {
    expect(mcpInfoFromString('mcp__github__add_comment')).toEqual({
      serverName: 'github',
      toolName: 'add_comment',
    })
  })
  test('returns server-only when tool absent', () => {
    expect(mcpInfoFromString('mcp__github')).toEqual({
      serverName: 'github',
      toolName: undefined,
    })
  })
  test('preserves double underscores in tool name (rejoins parts)', () => {
    // server="my", remainder="server__tool" → toolName preserves "__"
    expect(mcpInfoFromString('mcp__my__server__tool')).toEqual({
      serverName: 'my',
      toolName: 'server__tool',
    })
  })
  test('returns null for non-mcp prefix', () => {
    expect(mcpInfoFromString('Bash')).toBeNull()
    expect(mcpInfoFromString('not_mcp__server')).toBeNull()
  })
  test('returns null when serverName is missing (mcp__)', () => {
    expect(mcpInfoFromString('mcp__')).toBeNull()
  })
})

describe('getMcpPrefix', () => {
  test('builds mcp__<server>__ format', () => {
    expect(getMcpPrefix('github')).toBe('mcp__github__')
  })
  test('normalizes server name (dots → underscores)', () => {
    expect(getMcpPrefix('foo.bar')).toBe('mcp__foo_bar__')
  })
})

describe('buildMcpToolName', () => {
  test('combines server + tool with normalization', () => {
    expect(buildMcpToolName('github', 'add_comment')).toBe(
      'mcp__github__add_comment',
    )
  })
  test('normalizes both halves', () => {
    expect(buildMcpToolName('foo.bar', 'baz qux')).toBe('mcp__foo_bar__baz_qux')
  })
  test('round-trips with mcpInfoFromString for normalized inputs', () => {
    const built = buildMcpToolName('myserver', 'mytool')
    const parsed = mcpInfoFromString(built)
    expect(parsed).toEqual({ serverName: 'myserver', toolName: 'mytool' })
  })
})

describe('getToolNameForPermissionCheck', () => {
  test('returns mcp-prefixed name when mcpInfo present', () => {
    expect(
      getToolNameForPermissionCheck({
        name: 'Write',
        mcpInfo: { serverName: 'github', toolName: 'write' },
      }),
    ).toBe('mcp__github__write')
  })
  test('returns plain tool name when mcpInfo absent', () => {
    expect(getToolNameForPermissionCheck({ name: 'Bash' })).toBe('Bash')
  })
})

describe('getMcpDisplayName', () => {
  test('strips mcp__server__ prefix', () => {
    expect(getMcpDisplayName('mcp__github__add_comment', 'github')).toBe(
      'add_comment',
    )
  })
  test('handles normalized server name', () => {
    expect(getMcpDisplayName('mcp__foo_bar__tool', 'foo.bar')).toBe('tool')
  })
  test('returns original if prefix not present', () => {
    expect(getMcpDisplayName('not_an_mcp_name', 'github')).toBe(
      'not_an_mcp_name',
    )
  })
})

describe('extractMcpToolDisplayName', () => {
  test('strips "(MCP)" suffix', () => {
    expect(extractMcpToolDisplayName('Add comment (MCP)')).toBe('Add comment')
  })
  test('strips "<server> - " prefix', () => {
    expect(extractMcpToolDisplayName('github - Add comment (MCP)')).toBe(
      'Add comment',
    )
  })
  test('strips just (MCP) when no dash', () => {
    expect(extractMcpToolDisplayName('plain (MCP)')).toBe('plain')
  })
  test('returns original when no markers', () => {
    expect(extractMcpToolDisplayName('plain')).toBe('plain')
  })
  test('handles extra whitespace', () => {
    expect(extractMcpToolDisplayName('  github - Tool name  (MCP)  ')).toBe(
      'Tool name',
    )
  })
})
