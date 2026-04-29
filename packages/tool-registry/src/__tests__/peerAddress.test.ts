import { describe, expect, test } from 'bun:test'
import { parseAddress } from '../peerAddress.js'

describe('parseAddress — uds: scheme', () => {
  test('explicit uds: prefix', () => {
    expect(parseAddress('uds:/tmp/sock.sock')).toEqual({
      scheme: 'uds',
      target: '/tmp/sock.sock',
    })
  })

  test('strips exactly 4 chars (the "uds:" prefix)', () => {
    expect(parseAddress('uds:foo')).toEqual({ scheme: 'uds', target: 'foo' })
  })

  test('absolute path / → implicit uds: scheme', () => {
    // Critical contract: leading / on Unix means socket path. No
    // prefix needed for legacy compat — it's still routed to uds.
    expect(parseAddress('/tmp/socket')).toEqual({
      scheme: 'uds',
      target: '/tmp/socket',
    })
  })

  test('uds: with empty target → empty string target', () => {
    expect(parseAddress('uds:')).toEqual({ scheme: 'uds', target: '' })
  })
})

describe('parseAddress — bridge: scheme', () => {
  test('bridge: prefix', () => {
    expect(parseAddress('bridge:session-abc-123')).toEqual({
      scheme: 'bridge',
      target: 'session-abc-123',
    })
  })

  test('strips exactly 7 chars (the "bridge:" prefix)', () => {
    expect(parseAddress('bridge:x')).toEqual({ scheme: 'bridge', target: 'x' })
  })

  test('bridge: with empty target', () => {
    expect(parseAddress('bridge:')).toEqual({ scheme: 'bridge', target: '' })
  })
})

describe('parseAddress — other (fallback)', () => {
  test('plain string → other', () => {
    expect(parseAddress('teammate-name')).toEqual({
      scheme: 'other',
      target: 'teammate-name',
    })
  })

  test('relative path (no leading /) → other', () => {
    expect(parseAddress('foo/bar')).toEqual({
      scheme: 'other',
      target: 'foo/bar',
    })
  })

  test('empty string → other (with empty target)', () => {
    expect(parseAddress('')).toEqual({ scheme: 'other', target: '' })
  })

  test('arbitrary scheme like ws:// → other', () => {
    // Only uds:, bridge:, and / are recognized. Other URI schemes
    // pass through as 'other'.
    expect(parseAddress('ws://localhost:8080')).toEqual({
      scheme: 'other',
      target: 'ws://localhost:8080',
    })
  })

  test('starts with @ → other', () => {
    // Mention-style addressing (used elsewhere) is not a parseAddress
    // concept.
    expect(parseAddress('@alice')).toEqual({
      scheme: 'other',
      target: '@alice',
    })
  })
})

describe('parseAddress — branch ordering', () => {
  // Order matters: uds: → bridge: → / → other.
  // Documents this so a refactor doesn't accidentally re-order.

  test('uds:/path WINS over /path leading-slash heuristic', () => {
    // Explicit uds: prefix always wins.
    expect(parseAddress('uds:/some/path')).toEqual({
      scheme: 'uds',
      target: '/some/path',
    })
  })

  test('bridge: even when target starts with / → bridge wins', () => {
    expect(parseAddress('bridge:/looks-like-path')).toEqual({
      scheme: 'bridge',
      target: '/looks-like-path',
    })
  })

  test('parsing is case-sensitive (UDS: not recognized)', () => {
    expect(parseAddress('UDS:foo')).toEqual({
      scheme: 'other',
      target: 'UDS:foo',
    })
  })
})
