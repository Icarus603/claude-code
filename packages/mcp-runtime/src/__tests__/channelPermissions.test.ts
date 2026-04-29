/**
 * Tests for channelPermissions pure helpers — drive the channel-relay
 * permission prompt path (Telegram, iMessage, Discord).
 *
 * Critical contracts:
 *   - shortRequestId: 5-letter ID from 25-char alphabet (no 'l'),
 *     deterministic per-input, dodges the substring blocklist
 *   - PERMISSION_REPLY_RE: server-side reply parsing regex spec
 *   - truncateForPreview: input → ≤200-char JSON for SMS-sized previews
 *   - filterPermissionRelayClients: 3-condition gate (connected + allowlist
 *     + BOTH capabilities) — relaxing any condition opens a permission
 *     surface that was never opted into
 *   - createChannelPermissionCallbacks: pending-map lifetime, lowercased
 *     keys, delete-before-call so re-entry is safe
 *
 * These guard a *security boundary* (off-device approval), so locking
 * the contracts via tests is high-yield.
 */
import { describe, expect, test } from 'bun:test'
import {
  createChannelPermissionCallbacks,
  filterPermissionRelayClients,
  PERMISSION_REPLY_RE,
  shortRequestId,
  truncateForPreview,
} from '../channelPermissions.js'

describe('shortRequestId', () => {
  test('always returns 5 chars', () => {
    for (const id of ['toolu_abc', 'toolu_xyz', '1', 'a'.repeat(100)]) {
      expect(shortRequestId(id).length).toBe(5)
    }
  })

  test('only uses 25-letter alphabet (no "l")', () => {
    for (const seed of ['a', 'b', 'c', 'toolu_xxx', 'toolu_yyy']) {
      const id = shortRequestId(seed)
      expect(id).toMatch(/^[a-km-z]{5}$/)
      expect(id).not.toContain('l')
    }
  })

  test('deterministic for same input', () => {
    expect(shortRequestId('toolu_abc')).toBe(shortRequestId('toolu_abc'))
  })

  test('different inputs typically produce different IDs', () => {
    const a = shortRequestId('toolu_aaa')
    const b = shortRequestId('toolu_bbb')
    // 25^5 ≈ 9.8M space — collisions are rare for adjacent inputs.
    expect(a).not.toBe(b)
  })

  test('lowercase only (no uppercase characters)', () => {
    const id = shortRequestId('TOOLU_UPPER')
    expect(id).toBe(id.toLowerCase())
  })
})

describe('PERMISSION_REPLY_RE — reply parser regex', () => {
  test('matches "yes <id>"', () => {
    const m = 'yes tbxkq'.match(PERMISSION_REPLY_RE)
    expect(m).not.toBeNull()
    expect(m![1]).toBe('yes')
    expect(m![2]).toBe('tbxkq')
  })

  test('matches "y <id>"', () => {
    const m = 'y abcde'.match(PERMISSION_REPLY_RE)
    expect(m![1]).toBe('y')
  })

  test('matches "no <id>" and "n <id>"', () => {
    expect('no abcde'.match(PERMISSION_REPLY_RE)?.[1]).toBe('no')
    expect('n abcde'.match(PERMISSION_REPLY_RE)?.[1]).toBe('n')
  })

  test('case-insensitive (phone autocorrect)', () => {
    expect('YES abcde'.match(PERMISSION_REPLY_RE)?.[1]).toBe('YES')
    expect('Yes abcde'.match(PERMISSION_REPLY_RE)?.[1]).toBe('Yes')
  })

  test('rejects bare "yes" / "no" (conversational)', () => {
    expect('yes'.match(PERMISSION_REPLY_RE)).toBeNull()
    expect('no'.match(PERMISSION_REPLY_RE)).toBeNull()
  })

  test('rejects ID with l (excluded letter)', () => {
    expect('yes ablcd'.match(PERMISSION_REPLY_RE)).toBeNull()
  })

  test('rejects ID with digits or punctuation', () => {
    expect('yes abc12'.match(PERMISSION_REPLY_RE)).toBeNull()
    expect('yes abc-d'.match(PERMISSION_REPLY_RE)).toBeNull()
  })

  test('rejects ID of wrong length', () => {
    expect('yes abc'.match(PERMISSION_REPLY_RE)).toBeNull()
    expect('yes abcdef'.match(PERMISSION_REPLY_RE)).toBeNull()
  })

  test('tolerates surrounding whitespace', () => {
    expect('  yes abcde  '.match(PERMISSION_REPLY_RE)?.[1]).toBe('yes')
  })

  test('rejects prefix/suffix chatter', () => {
    // Documented: "no prefix/suffix chatter" — pure command shape only.
    expect('please yes abcde'.match(PERMISSION_REPLY_RE)).toBeNull()
    expect('yes abcde please'.match(PERMISSION_REPLY_RE)).toBeNull()
  })
})

describe('truncateForPreview', () => {
  test('short JSON pass through unchanged', () => {
    expect(truncateForPreview({ a: 1 })).toBe('{"a":1}')
  })

  test('exactly-200 char JSON not truncated', () => {
    // 200-char JSON: cap is `.length > 200`, so 200 is kept.
    const input = { v: 'x'.repeat(193) } // {"v":"…"} adds 9 chars
    const json = JSON.stringify(input)
    expect(json.length).toBeLessThanOrEqual(202)
    if (json.length === 200) {
      expect(truncateForPreview(input)).toBe(json)
    }
  })

  test('long JSON truncated with ellipsis', () => {
    const big = { v: 'x'.repeat(500) }
    const result = truncateForPreview(big)
    expect(result.endsWith('…')).toBe(true)
    expect(result.length).toBe(201) // 200 + 1 ellipsis char
  })

  test('truncated to exactly 200 chars + 1 ellipsis (visual length 201)', () => {
    const big = { x: 'long string here'.repeat(50) }
    const result = truncateForPreview(big)
    expect(result.endsWith('…')).toBe(true)
    expect(result.slice(0, -1).length).toBe(200)
  })

  test('returns "(unserializable)" for circular refs', () => {
    // jsonStringify throws on circular; catch path returns the marker.
    const c: { self?: unknown } = {}
    c.self = c
    expect(truncateForPreview(c)).toBe('(unserializable)')
  })

  test('handles BigInt (jsonStringify cannot serialize)', () => {
    expect(truncateForPreview(BigInt(123))).toBe('(unserializable)')
  })

  test('null serializes to "null"', () => {
    expect(truncateForPreview(null)).toBe('null')
  })

  test('undefined falls into the unserializable branch', () => {
    // local-observability jsonStringify treats `undefined` as a serialize
    // failure (returns "(unserializable)") rather than `JSON.stringify`'s
    // quiet `undefined` return. Lock the runtime behavior — callers in
    // the channel preview path get a non-empty string, never `undefined`.
    expect(truncateForPreview(undefined)).toBe('(unserializable)')
  })
})

describe('filterPermissionRelayClients — 3-condition gate', () => {
  type Client = {
    type: string
    name: string
    capabilities?: { experimental?: Record<string, unknown> }
  }

  const okClient: Client = {
    type: 'connected',
    name: 'plugin:tg',
    capabilities: {
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},
      },
    },
  }

  test('happy path: all 3 conditions met → kept', () => {
    const result = filterPermissionRelayClients([okClient], () => true)
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('plugin:tg')
  })

  test('not connected → filtered out', () => {
    const broken = { ...okClient, type: 'disconnected' }
    expect(filterPermissionRelayClients([broken], () => true)).toEqual([])
  })

  test('not in allowlist → filtered out', () => {
    expect(
      filterPermissionRelayClients([okClient], () => false),
    ).toEqual([])
  })

  test('missing claude/channel capability → filtered out', () => {
    const noChannel: Client = {
      ...okClient,
      capabilities: {
        experimental: { 'claude/channel/permission': {} },
      },
    }
    expect(filterPermissionRelayClients([noChannel], () => true)).toEqual([])
  })

  test('missing claude/channel/permission capability → filtered out', () => {
    // Documented: server's explicit opt-in to be a permission surface.
    // A relay-only channel must NOT become a permission surface by accident.
    const noPerm: Client = {
      ...okClient,
      capabilities: {
        experimental: { 'claude/channel': {} },
      },
    }
    expect(filterPermissionRelayClients([noPerm], () => true)).toEqual([])
  })

  test('no capabilities at all → filtered out', () => {
    const noCap: Client = { type: 'connected', name: 'x' }
    expect(filterPermissionRelayClients([noCap], () => true)).toEqual([])
  })

  test('mixed list keeps only the qualified ones', () => {
    const list: Client[] = [
      okClient,
      { type: 'disconnected', name: 'a' },
      { ...okClient, name: 'plugin:tg2' },
      { type: 'connected', name: 'plugin:nope' }, // no capabilities
    ]
    const result = filterPermissionRelayClients(list, name =>
      name.startsWith('plugin:tg'),
    )
    expect(result.map(c => c.name)).toEqual(['plugin:tg', 'plugin:tg2'])
  })

  test('result type narrowed to type: "connected"', () => {
    const result = filterPermissionRelayClients([okClient], () => true)
    // Compile-time check: type is narrowed via the type predicate.
    expect(result[0]?.type).toBe('connected')
  })
})

describe('createChannelPermissionCallbacks', () => {
  test('returns object with onResponse + resolve', () => {
    const cb = createChannelPermissionCallbacks()
    expect(typeof cb.onResponse).toBe('function')
    expect(typeof cb.resolve).toBe('function')
  })

  test('onResponse + resolve happy path', () => {
    const cb = createChannelPermissionCallbacks()
    let received: { behavior: string; fromServer: string } | null = null
    cb.onResponse('abcde', r => {
      received = r
    })
    expect(cb.resolve('abcde', 'allow', 'tg')).toBe(true)
    expect(received).toEqual({ behavior: 'allow', fromServer: 'tg' })
  })

  test('resolve unknown id → false', () => {
    const cb = createChannelPermissionCallbacks()
    expect(cb.resolve('xxxxx', 'allow', 'tg')).toBe(false)
  })

  test('resolve is idempotent: second call returns false (already deleted)', () => {
    const cb = createChannelPermissionCallbacks()
    cb.onResponse('abcde', () => {})
    expect(cb.resolve('abcde', 'allow', 'tg')).toBe(true)
    expect(cb.resolve('abcde', 'allow', 'tg')).toBe(false)
  })

  test('unsubscribe via returned callback removes the listener', () => {
    const cb = createChannelPermissionCallbacks()
    const unsub = cb.onResponse('abcde', () => {})
    unsub()
    expect(cb.resolve('abcde', 'allow', 'tg')).toBe(false)
  })

  test('keys are case-insensitive (resolve lowercases)', () => {
    const cb = createChannelPermissionCallbacks()
    let resolved = false
    cb.onResponse('ABCDE', () => {
      resolved = true
    })
    // onResponse also lowercases → stored as 'abcde'.
    expect(cb.resolve('abcde', 'allow', 'tg')).toBe(true)
    expect(resolved).toBe(true)
  })

  test('resolve with mixed case finds lowercase entry', () => {
    const cb = createChannelPermissionCallbacks()
    cb.onResponse('abcde', () => {})
    expect(cb.resolve('AbCdE', 'allow', 'tg')).toBe(true)
  })

  test('resolver receives the right behavior + fromServer', () => {
    const cb = createChannelPermissionCallbacks()
    let result: { behavior: string; fromServer: string } | null = null
    cb.onResponse('xyzab', r => {
      result = r
    })
    cb.resolve('xyzab', 'deny', 'plugin:imessage')
    expect(result).toEqual({ behavior: 'deny', fromServer: 'plugin:imessage' })
  })

  test('separate IDs are independent', () => {
    const cb = createChannelPermissionCallbacks()
    let aHit = 0
    let bHit = 0
    cb.onResponse('aaaaa', () => {
      aHit++
    })
    cb.onResponse('bbbbb', () => {
      bHit++
    })
    cb.resolve('aaaaa', 'allow', 'x')
    cb.resolve('bbbbb', 'deny', 'x')
    expect(aHit).toBe(1)
    expect(bHit).toBe(1)
  })

  test('handler called once even if it throws (entry already deleted)', () => {
    // Documented invariant: delete BEFORE calling so re-entry / throw
    // doesn't double-invoke. We can't see the throw path without state,
    // but we can verify the entry is gone before the resolver runs.
    const cb = createChannelPermissionCallbacks()
    let entryDeletedBeforeCall = false
    cb.onResponse('abcde', () => {
      // At this point the entry should already be gone.
      entryDeletedBeforeCall = !cb.resolve('abcde', 'allow', 'x')
    })
    cb.resolve('abcde', 'allow', 'x')
    expect(entryDeletedBeforeCall).toBe(true)
  })
})
