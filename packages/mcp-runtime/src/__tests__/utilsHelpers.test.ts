/**
 * Tests for mcp-runtime/utils.ts pure helpers.
 *
 * filterToolsByServer / commandBelongsToServer / hashMcpConfig drive
 * /reload-plugins and the "this server's tools" UI. Wrong filtering
 * either leaks tools across server boundaries (auth confusion) or
 * makes a server's tools invisible.
 *
 * hashMcpConfig is the change-detection seed for reconnect-on-edit.
 * A regression that ignores keys or includes `scope` would either
 * miss real edits (server stays stale) or reconnect spuriously
 * (provenance change ≠ config change).
 */
import { describe, expect, test } from 'bun:test'
import type { Command } from '../types.js'
import type { Tool } from '../types.js'
import {
  commandBelongsToServer,
  excludeToolsByServer,
  filterCommandsByServer,
  filterToolsByServer,
  hashMcpConfig,
} from '../utils.js'

function tool(name: string): Tool {
  return { name } as Tool
}

function cmd(name: string, extra: Partial<Command> = {}): Command {
  return { name, ...extra } as Command
}

describe('filterToolsByServer', () => {
  test('matches mcp__server__tool prefix', () => {
    const tools = [
      tool('mcp__github__list_issues'),
      tool('mcp__gitlab__list_issues'),
      tool('mcp__github__create_pr'),
    ]
    const result = filterToolsByServer(tools, 'github')
    expect(result).toHaveLength(2)
    expect(result.map(t => t.name)).toEqual([
      'mcp__github__list_issues',
      'mcp__github__create_pr',
    ])
  })

  test('non-MCP tools (no prefix) are excluded', () => {
    expect(filterToolsByServer([tool('Bash'), tool('Edit')], 'github')).toEqual(
      [],
    )
  })

  test('server name with chars normalized', () => {
    // normalizeNameForMCP replaces non-allowlist chars with `_`. So a
    // server "my-server" matches `mcp__my-server__*` (dashes are kept
    // by the normalizer's [a-zA-Z0-9_-] allowlist).
    const tools = [tool('mcp__my-server__do_thing')]
    expect(filterToolsByServer(tools, 'my-server')).toHaveLength(1)
  })

  test('empty tools array returns empty', () => {
    expect(filterToolsByServer([], 'github')).toEqual([])
  })

  test('tool with undefined name is filtered out (no startsWith on undefined)', () => {
    const t = { name: undefined } as Tool
    expect(filterToolsByServer([t], 'github')).toEqual([])
  })
})

describe('commandBelongsToServer — mcp__ AND server: prefixes', () => {
  test('mcp__server__cmd matches', () => {
    expect(commandBelongsToServer(cmd('mcp__github__test'), 'github')).toBe(true)
  })

  test('server:cmd (skill format) matches', () => {
    // MCP skills use `<server>:<skill>` (matches plugin/nested-dir
    // skill naming).
    expect(commandBelongsToServer(cmd('github:list_issues'), 'github')).toBe(
      true,
    )
  })

  test('different server → false', () => {
    expect(commandBelongsToServer(cmd('mcp__gitlab__test'), 'github')).toBe(
      false,
    )
  })

  test('no name → false', () => {
    expect(commandBelongsToServer(cmd(''), 'github')).toBe(false)
  })
})

describe('filterCommandsByServer', () => {
  test('mixes both name shapes', () => {
    const commands = [
      cmd('mcp__github__list_prs'),
      cmd('github:create_pr'),
      cmd('mcp__gitlab__list_issues'),
      cmd('local_command'),
    ]
    const result = filterCommandsByServer(commands, 'github')
    expect(result).toHaveLength(2)
  })
})

describe('excludeToolsByServer — inverse filter', () => {
  test('removes only the named server', () => {
    const tools = [
      tool('mcp__github__a'),
      tool('mcp__gitlab__b'),
      tool('Bash'),
    ]
    const result = excludeToolsByServer(tools, 'github')
    expect(result.map(t => t.name)).toEqual(['mcp__gitlab__b', 'Bash'])
  })

  test('empty → empty', () => {
    expect(excludeToolsByServer([], 'github')).toEqual([])
  })
})

describe('hashMcpConfig — stable change-detection', () => {
  test('same content → same hash', () => {
    const a = { scope: 'user', command: 'node', args: ['x'] } as never
    const b = { scope: 'user', command: 'node', args: ['x'] } as never
    expect(hashMcpConfig(a)).toBe(hashMcpConfig(b))
  })

  test('scope is EXCLUDED from hash (provenance, not content)', () => {
    // Documented: moving a server from .mcp.json to settings.json
    // shouldn't reconnect it.
    const userScope = { scope: 'user', command: 'x' } as never
    const projectScope = { scope: 'project', command: 'x' } as never
    expect(hashMcpConfig(userScope)).toBe(hashMcpConfig(projectScope))
  })

  test('different command → different hash', () => {
    const a = { scope: 'user', command: 'a' } as never
    const b = { scope: 'user', command: 'b' } as never
    expect(hashMcpConfig(a)).not.toBe(hashMcpConfig(b))
  })

  test('key order in nested objects does NOT affect hash (sorted)', () => {
    // Documented: keys sorted so {a:1,b:2} and {b:2,a:1} hash the same.
    const a = {
      scope: 'user',
      env: { PATH: '/x', NODE_OPTIONS: '--max-old-space-size=4096' },
    } as never
    const b = {
      scope: 'user',
      env: { NODE_OPTIONS: '--max-old-space-size=4096', PATH: '/x' },
    } as never
    expect(hashMcpConfig(a)).toBe(hashMcpConfig(b))
  })

  test('hash is 16 hex chars (sliced from sha256)', () => {
    const h = hashMcpConfig({ scope: 'user', command: 'x' } as never)
    expect(h).toMatch(/^[0-9a-f]{16}$/)
  })

  test('changing nested env value → hash changes', () => {
    const a = { scope: 'user', env: { PATH: '/a' } } as never
    const b = { scope: 'user', env: { PATH: '/b' } } as never
    expect(hashMcpConfig(a)).not.toBe(hashMcpConfig(b))
  })
})
