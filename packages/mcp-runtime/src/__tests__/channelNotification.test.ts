/**
 * Tests for wrapChannelMessage + findChannelEntry — pure helpers in
 * the channel-notification path (Discord/Slack/SMS MCP servers
 * pushing inbound user messages into the conversation).
 *
 * Wrong XML wrapping = attribute injection (a crafted meta key
 * could break out of the attribute structure and inject content).
 * Wrong entry matcher = a runtime plugin name confused with a
 * trusted server entry, bypassing the {marketplace, plugin}
 * allowlist gate.
 *
 * findChannelEntry is the FIRST GATE in gateChannelServer — if
 * it returns the wrong entry, the wrong allowlist branch runs.
 */
import { describe, expect, test } from 'bun:test'
import {
  findChannelEntry,
  wrapChannelMessage,
} from '../channelNotification.js'

type ChannelEntry = Parameters<typeof findChannelEntry>[1][number]

describe('wrapChannelMessage — basic shape', () => {
  test('content + serverName produces <channel> wrapper', () => {
    expect(wrapChannelMessage('slack', 'hello')).toBe(
      '<channel source="slack">\nhello\n</channel>',
    )
  })

  test('empty content still wraps correctly', () => {
    expect(wrapChannelMessage('slack', '')).toBe(
      '<channel source="slack">\n\n</channel>',
    )
  })

  test('multi-line content preserved verbatim inside wrapper', () => {
    expect(wrapChannelMessage('discord', 'line1\nline2\nline3')).toBe(
      '<channel source="discord">\nline1\nline2\nline3\n</channel>',
    )
  })
})

describe('wrapChannelMessage — meta attribute filtering', () => {
  test('safe meta keys included as XML attributes', () => {
    const r = wrapChannelMessage('slack', 'hi', {
      chat_id: 'C1234',
      thread_ts: '1234.5678',
    })
    expect(r).toContain('chat_id="C1234"')
    expect(r).toContain('thread_ts="1234.5678"')
  })

  test('meta key with hyphen → REJECTED (only [a-zA-Z_][a-zA-Z0-9_]*)', () => {
    // Documented contract: stricter than XML spec — `-`, `:`, `.` all rejected.
    const r = wrapChannelMessage('slack', 'hi', { 'x-team': 'eng' })
    expect(r).not.toContain('x-team')
  })

  test('meta key starting with digit → REJECTED', () => {
    const r = wrapChannelMessage('slack', 'hi', { '1key': 'val' })
    expect(r).not.toContain('1key')
  })

  test('meta key with attribute-injection chars → REJECTED', () => {
    // SECURITY: a key like `x" onevent="alert(1)` would break the
    // attribute structure if not filtered.
    const r = wrapChannelMessage('slack', 'hi', {
      'x" onevent="alert(1)': 'val',
    })
    expect(r).not.toContain('onevent')
    expect(r).not.toContain('alert')
  })

  test('meta value with quote → escaped in XML', () => {
    // The VALUE side uses escapeXmlAttr which handles double-quote etc.
    const r = wrapChannelMessage('slack', 'hi', { user: 'alice"bob' })
    // Value escaped, key still recognized.
    expect(r).toContain('user="alice')
    expect(r).not.toMatch(/user="alice"bob"/)
  })

  test('serverName with quote → escaped in source attribute', () => {
    const r = wrapChannelMessage('s"erver', 'hi')
    // Source value escaped — must NOT contain a literal naked quote that
    // breaks attribute structure.
    expect(r).toMatch(/^<channel source="[^"]*">/)
  })

  test('underscore-only key safe', () => {
    const r = wrapChannelMessage('slack', 'hi', { _internal: 'x' })
    expect(r).toContain('_internal="x"')
  })

  test('no meta → no attributes beyond source', () => {
    const r = wrapChannelMessage('slack', 'hi')
    expect(r).toBe('<channel source="slack">\nhi\n</channel>')
  })

  test('all meta keys rejected → no attributes beyond source', () => {
    const r = wrapChannelMessage('slack', 'hi', { '!bad': 'x', '-bad': 'y' })
    expect(r).toBe('<channel source="slack">\nhi\n</channel>')
  })

  test('mixed safe + unsafe meta: only safe ones preserved', () => {
    const r = wrapChannelMessage('slack', 'hi', {
      chat_id: 'OK',
      'evil-key': 'BAD',
    })
    expect(r).toContain('chat_id="OK"')
    expect(r).not.toContain('evil-key')
    expect(r).not.toContain('BAD')
  })
})

// ────────────────────────────────────────────────────────────────────
// findChannelEntry: matches MCP server names against --channels entries
// ────────────────────────────────────────────────────────────────────

describe('findChannelEntry — server-kind exact match', () => {
  test('bare name matches server-kind entry', () => {
    const channels: ChannelEntry[] = [{ kind: 'server', name: 'slack' }]
    expect(findChannelEntry('slack', channels)).toBe(channels[0])
  })

  test('different name → undefined', () => {
    const channels: ChannelEntry[] = [{ kind: 'server', name: 'slack' }]
    expect(findChannelEntry('discord', channels)).toBeUndefined()
  })

  test('case-sensitive', () => {
    const channels: ChannelEntry[] = [{ kind: 'server', name: 'slack' }]
    expect(findChannelEntry('Slack', channels)).toBeUndefined()
  })
})

describe('findChannelEntry — plugin-kind matches plugin:NAME:RUNTIME format', () => {
  test('plugin:slack:1234 matches plugin entry { name: "slack" }', () => {
    const channels: ChannelEntry[] = [
      { kind: 'plugin', name: 'slack', marketplace: 'anthropic' },
    ]
    expect(findChannelEntry('plugin:slack:1234', channels)).toBe(channels[0])
  })

  test('plugin:OTHER:1234 does NOT match plugin entry { name: "slack" }', () => {
    const channels: ChannelEntry[] = [
      { kind: 'plugin', name: 'slack', marketplace: 'anthropic' },
    ]
    expect(findChannelEntry('plugin:other:1234', channels)).toBeUndefined()
  })

  test('bare "plugin" with no second segment → no match', () => {
    const channels: ChannelEntry[] = [
      { kind: 'plugin', name: 'slack', marketplace: 'anthropic' },
    ]
    // Server name 'plugin' has parts[0]='plugin' but parts[1]=undefined.
    expect(findChannelEntry('plugin', channels)).toBeUndefined()
  })

  test('non-prefix server name does not match plugin entry', () => {
    // 'slackish' should not match plugin { name: 'slack' }.
    const channels: ChannelEntry[] = [
      { kind: 'plugin', name: 'slack', marketplace: 'anthropic' },
    ]
    expect(findChannelEntry('slackish', channels)).toBeUndefined()
  })
})

describe('findChannelEntry — discriminates kinds correctly', () => {
  test('server-kind entry never matches plugin-prefixed runtime name', () => {
    const channels: ChannelEntry[] = [
      { kind: 'server', name: 'plugin:slack:x' },
    ]
    // server-kind needs EXACT match, so 'plugin:slack:x' as runtime name
    // matches the literal 'plugin:slack:x' entry.
    expect(findChannelEntry('plugin:slack:x', channels)).toBe(channels[0])
    // But a different runtime 'plugin:slack:y' won't.
    expect(findChannelEntry('plugin:slack:y', channels)).toBeUndefined()
  })

  test('plugin-kind entry never matches bare name', () => {
    const channels: ChannelEntry[] = [
      { kind: 'plugin', name: 'slack', marketplace: 'anthropic' },
    ]
    expect(findChannelEntry('slack', channels)).toBeUndefined()
  })

  test('mixed entries: plugin + server, returns first match in order', () => {
    const channels: ChannelEntry[] = [
      { kind: 'server', name: 'discord' },
      { kind: 'plugin', name: 'slack', marketplace: 'anthropic' },
    ]
    expect(findChannelEntry('discord', channels)).toBe(channels[0])
    expect(findChannelEntry('plugin:slack:abc', channels)).toBe(channels[1])
  })
})

describe('findChannelEntry — degenerate cases', () => {
  test('empty channels array → undefined', () => {
    expect(findChannelEntry('slack', [])).toBeUndefined()
  })

  test('empty server name → only matches a server entry with empty name (none here)', () => {
    expect(
      findChannelEntry('', [{ kind: 'server', name: 'slack' }]),
    ).toBeUndefined()
  })
})
