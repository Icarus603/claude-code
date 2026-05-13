/**
 * WaitForMcpServers — invariant tests against ant v2.1.136 (3146.js).
 *
 * Covers the pure helpers (prompt text, schema shapes, name
 * normalization, isEnabled gates). The full poll loop is integration
 * and lives in fixture-driven tests elsewhere.
 */
import { describe, expect, test } from 'bun:test'
import {
  WaitForMcpServersTool,
  normalizeServerName,
} from '../WaitForMcpServersTool.js'
import {
  WAIT_FOR_MCP_SERVERS_MAX_BLOCK_MS,
  WAIT_FOR_MCP_SERVERS_POLL_MS,
  WAIT_FOR_MCP_SERVERS_TOOL_NAME,
} from '../constants.js'
import { getWaitForMcpServersPrompt } from '../prompt.js'

describe('constants match ant v2.1.136', () => {
  test('tool name = "WaitForMcpServers" (ant zzH)', () => {
    expect(WAIT_FOR_MCP_SERVERS_TOOL_NAME).toBe('WaitForMcpServers')
  })
  test('max block = 5000ms (ant w$5)', () => {
    expect(WAIT_FOR_MCP_SERVERS_MAX_BLOCK_MS).toBe(5_000)
  })
  test('poll interval = 50ms (ant a6 call)', () => {
    expect(WAIT_FOR_MCP_SERVERS_POLL_MS).toBe(50)
  })
})

describe('prompt text (ant j58)', () => {
  test('preserves verbatim phrasing the model trains against', () => {
    const text = getWaitForMcpServersPrompt()
    expect(text).toContain(
      'Wait for MCP servers that are still connecting and whose tools are not',
    )
    expect(text).toContain('Pass `servers` to wait for specific ones')
    expect(text).toContain('Returns ready=true when servers are')
    expect(text).toContain(
      'You do not need to ask the user for confirmation to use this tool.',
    )
  })
})

describe('tool surface (ant g37)', () => {
  test('isReadOnly: true', () => {
    expect(WaitForMcpServersTool.isReadOnly?.({} as never)).toBe(true)
  })
  test('isConcurrencySafe: false', () => {
    expect(WaitForMcpServersTool.isConcurrencySafe?.()).toBe(false)
  })
  test('name matches constant', () => {
    expect(WaitForMcpServersTool.name).toBe(WAIT_FOR_MCP_SERVERS_TOOL_NAME)
  })
  test('userFacingName = "MCP Wait For Servers" (ant B37)', () => {
    expect(WaitForMcpServersTool.userFacingName?.({} as never)).toBe(
      'MCP Wait For Servers',
    )
  })
  test('renderToolUseMessage(no servers) = "Wait for pending MCP servers..."', () => {
    expect(
      WaitForMcpServersTool.renderToolUseMessage?.({} as never, {} as never),
    ).toBe('Wait for pending MCP servers to connect')
  })
  test('renderToolUseMessage(with servers) lists names', () => {
    expect(
      WaitForMcpServersTool.renderToolUseMessage?.(
        { servers: ['github', 'gitlab'] } as never,
        {} as never,
      ),
    ).toBe('Wait for MCP servers to connect: github, gitlab')
  })
})

describe('checkPermissions (ant: always allow)', () => {
  test('returns behavior:allow with unchanged input', async () => {
    const input = { servers: ['x'] }
    const result = await WaitForMcpServersTool.checkPermissions?.(
      input as never,
      {} as never,
    )
    expect(result?.behavior).toBe('allow')
  })
})

// ─── normalizeServerName (ant l1, 0676.js) ─────────────────────────────
// CRITICAL: prior ccb impl did `.toLowerCase().replace(/[^a-z0-9]+/g, '_')`
// which (a) lowercased, (b) collapsed runs unconditionally, (c) dropped `_`
// and `-` from the char class. Ant `l1` does NONE of these — it preserves
// case, keeps `_-` in the safe class, and only runs the collapse + strip
// for names with the `"claude.ai "` prefix.
describe('normalizeServerName (ant l1)', () => {
  test('preserves case (NOT .toLowerCase())', () => {
    // Pin: "GitHub" stays "GitHub" — matching is identifier-based, not
    // fuzzy. ant `l1("GitHub") === "GitHub"`.
    expect(normalizeServerName('GitHub')).toBe('GitHub')
  })

  test('preserves underscores and hyphens (safe identifier chars)', () => {
    expect(normalizeServerName('my_server')).toBe('my_server')
    expect(normalizeServerName('server-1')).toBe('server-1')
    expect(normalizeServerName('mcp_github-remote')).toBe('mcp_github-remote')
  })

  test('replaces each unsafe char with single underscore (no run-collapse)', () => {
    // ant `/g` per-char replace, NOT `[…]+` greedy. "foo  bar" → "foo__bar".
    expect(normalizeServerName('foo  bar')).toBe('foo__bar')
    expect(normalizeServerName('foo.bar')).toBe('foo_bar')
    expect(normalizeServerName('foo bar baz')).toBe('foo_bar_baz')
  })

  test('claude.ai-prefixed names collapse runs and strip leading/trailing _', () => {
    // ant special-cases names starting with "claude.ai " because the
    // bridge layer emits "claude.ai Generated  Server  Name" with
    // multi-space runs that would otherwise be "claude_ai_Generated__Server__Name".
    expect(normalizeServerName('claude.ai  Bot')).toBe('claude_ai_Bot')
    expect(normalizeServerName('claude.ai  My  Custom Server')).toBe(
      'claude_ai_My_Custom_Server',
    )
    expect(normalizeServerName('claude.ai ')).toBe('claude_ai')
  })

  test('non-claude.ai-prefixed names keep multi-space runs as multi-underscore', () => {
    // Pin: only the "claude.ai " prefix triggers the collapse.
    expect(normalizeServerName('my prefix  bar')).toBe('my_prefix__bar')
    // Leading/trailing underscores are NOT stripped here either.
    expect(normalizeServerName(' foo ')).toBe('_foo_')
  })

  test('empty string round-trips', () => {
    expect(normalizeServerName('')).toBe('')
  })
})

describe('mapToolResultToToolResultBlockParam', () => {
  test('ready=true and only connected → is_error=false', () => {
    const param = WaitForMcpServersTool.mapToolResultToToolResultBlockParam(
      {
        ready: true,
        connected: ['gh'],
        failed: [],
        stillPending: [],
        needsAuth: [],
        disabled: [],
        unknown: [],
      },
      'tu_1' as never,
    )
    expect(param.is_error).toBe(false)
    expect(param.content).toContain('ready: true')
    expect(param.content).toContain(
      'Connected (their tools are now available — call them directly): gh',
    )
  })
  test('ready=false with mixed categories → is_error=true', () => {
    const param = WaitForMcpServersTool.mapToolResultToToolResultBlockParam(
      {
        ready: false,
        connected: ['gh'],
        failed: ['gl'],
        stillPending: ['s3'],
        needsAuth: ['na'],
        disabled: ['dx'],
        unknown: ['??'],
      },
      'tu_2' as never,
    )
    expect(param.is_error).toBe(true)
    expect(param.content).toContain('Failed to connect: gl')
    expect(param.content).toContain('Still connecting (try again or proceed without): s3')
    expect(param.content).toContain(
      'Needs authentication (ask the user to run /mcp): na',
    )
    expect(param.content).toContain('Disabled (ask the user to enable via /mcp): dx')
    expect(param.content).toContain(
      'Unknown (no MCP server with this name is configured): ??',
    )
  })
  test('empty categories are filtered out of the body', () => {
    const param = WaitForMcpServersTool.mapToolResultToToolResultBlockParam(
      {
        ready: true,
        connected: [],
        failed: [],
        stillPending: [],
        needsAuth: [],
        disabled: [],
        unknown: [],
      },
      'tu_3' as never,
    )
    // Only the "ready: true" line should appear when every category is empty.
    expect(param.content).toBe('ready: true')
  })
})
