/**
 * Tests for `logNameCollision` (ant v2.1.136 `LzH`, 2643.js).
 *
 * We intercept `logEvent` via mock.module so we can pin the exact payload
 * shape ant emits — `source_count` MUST be the unique dedup count (not the
 * raw entries length), `sources` MUST be the sorted-unique-joined string,
 * and `winner_source` MUST be the LAST raw push to the name's bucket (not
 * the first, not a precedence-min). Those three semantics broke at
 * various points during the V7 port; pin them so they can't regress.
 */
import { describe, expect, mock, test, beforeEach } from 'bun:test'
import * as realObs from '@claude-code/local-observability'

type EventPayload = Record<string, unknown>
const events: { name: string; payload: EventPayload }[] = []

// Spread the real exports first — bun:test mock.module is GLOBAL across
// the test run, so failing to spread silently replaces the WHOLE module
// for every test in the suite. Per feedback_bun_mock_module_global_scope.md
// and the verify-mock-module-spread doctor rule.
mock.module('@claude-code/local-observability', () => ({
  ...realObs,
  logEvent: (name: string, payload: EventPayload) => {
    events.push({ name, payload })
  },
}))

const { logNameCollision } = await import('../nameCollision.js')

beforeEach(() => {
  events.length = 0
})

describe('logNameCollision (ant LzH)', () => {
  test('no event fired when every name has a single source', () => {
    logNameCollision({
      itemType: 'skill',
      entries: [
        { name: 'a', source: 'user' },
        { name: 'b', source: 'project' },
      ],
      resolves: true,
    })
    expect(events).toEqual([])
  })

  test('same-source duplicates dedupe and fire NO event', () => {
    // ant `A.length < 2` after `new Set` — two entries from the same
    // source are not a collision.
    logNameCollision({
      itemType: 'skill',
      entries: [
        { name: 'foo', source: 'user' },
        { name: 'foo', source: 'user' },
      ],
      resolves: true,
    })
    expect(events).toEqual([])
  })

  test('two distinct sources emit one event with source_count=2', () => {
    logNameCollision({
      itemType: 'skill',
      entries: [
        { name: 'foo', source: 'user' },
        { name: 'foo', source: 'project' },
      ],
      resolves: true,
    })
    expect(events).toHaveLength(1)
    const ev = events[0]!
    expect(ev.name).toBe('tengu_plugin_name_collision')
    expect(ev.payload.item_type).toBe('skill')
    expect(ev.payload._PROTO_skill_name).toBe('foo')
    expect(typeof ev.payload.item_name_hash).toBe('string')
    expect(ev.payload.source_count).toBe(2)
    expect(ev.payload.sources).toBe('project,user') // sorted-unique-joined
    expect(ev.payload.winner_source).toBe('project') // last push wins
  })

  test('sources are deduped before count, but raw-last still wins', () => {
    // ant: K.set/push preserves raw order; new Set is for source_count + sources.
    // winner_source = T[T.length - 1] reads the RAW last push.
    logNameCollision({
      itemType: 'plugin',
      entries: [
        { name: 'foo', source: 'user' },
        { name: 'foo', source: 'user' },
        { name: 'foo', source: 'project' },
      ],
      resolves: true,
    })
    expect(events).toHaveLength(1)
    expect(events[0]!.payload.source_count).toBe(2)
    expect(events[0]!.payload.sources).toBe('project,user')
    expect(events[0]!.payload.winner_source).toBe('project')
  })

  test('resolves=false omits winner_source', () => {
    logNameCollision({
      itemType: 'skill',
      entries: [
        { name: 'foo', source: 'user' },
        { name: 'foo', source: 'project' },
      ],
      resolves: false,
    })
    expect(events).toHaveLength(1)
    expect('winner_source' in events[0]!.payload).toBe(false)
  })

  test('multiple distinct names each evaluated independently', () => {
    logNameCollision({
      itemType: 'agent',
      entries: [
        { name: 'a', source: 'user' },
        { name: 'a', source: 'project' },
        { name: 'b', source: 'user' }, // no collision, single source
        { name: 'c', source: 'user' },
        { name: 'c', source: 'project' },
        { name: 'c', source: 'managed' },
      ],
      resolves: true,
    })
    const byName = new Map(events.map(e => [e.payload._PROTO_skill_name, e]))
    expect(byName.has('a')).toBe(true)
    expect(byName.has('b')).toBe(false) // single source
    expect(byName.has('c')).toBe(true)
    expect(byName.get('a')!.payload.source_count).toBe(2)
    expect(byName.get('a')!.payload.sources).toBe('project,user')
    expect(byName.get('a')!.payload.winner_source).toBe('project')
    expect(byName.get('c')!.payload.source_count).toBe(3)
    expect(byName.get('c')!.payload.sources).toBe('managed,project,user')
    expect(byName.get('c')!.payload.winner_source).toBe('managed')
  })

  test('winner_source uses LAST push (not first, not precedence-min)', () => {
    // Critical: this differs from many "natural" implementations that
    // would pick first push. Ant explicitly does `T[T.length - 1]`.
    logNameCollision({
      itemType: 'outputStyle',
      entries: [
        { name: 'foo', source: 'managed' },
        { name: 'foo', source: 'project' },
        { name: 'foo', source: 'user' },
      ],
      resolves: true,
    })
    expect(events[0]!.payload.winner_source).toBe('user')
  })

  test('item_name_hash is deterministic and 16 hex chars', () => {
    logNameCollision({
      itemType: 'skill',
      entries: [
        { name: 'foo', source: 'user' },
        { name: 'foo', source: 'project' },
      ],
      resolves: true,
    })
    logNameCollision({
      itemType: 'skill',
      entries: [
        { name: 'foo', source: 'user' },
        { name: 'foo', source: 'managed' },
      ],
      resolves: true,
    })
    expect(events).toHaveLength(2)
    expect(events[0]!.payload.item_name_hash).toBe(
      events[1]!.payload.item_name_hash,
    )
    expect(events[0]!.payload.item_name_hash as string).toMatch(/^[0-9a-f]{16}$/)
  })

  test('command itemType (ccb plugin-commands path) emits cleanly', () => {
    // Pin that the loader's "command" use-case round-trips through
    // the same code path as ant's skill/agent/plugin/outputStyle.
    logNameCollision({
      itemType: 'command',
      entries: [
        { name: 'review', source: 'plugin:foo' },
        { name: 'review', source: 'plugin:bar' },
      ],
      resolves: true,
    })
    expect(events).toHaveLength(1)
    expect(events[0]!.payload.item_type).toBe('command')
    expect(events[0]!.payload.source_count).toBe(2)
    expect(events[0]!.payload.sources).toBe('plugin:bar,plugin:foo')
    expect(events[0]!.payload.winner_source).toBe('plugin:bar')
  })
})
