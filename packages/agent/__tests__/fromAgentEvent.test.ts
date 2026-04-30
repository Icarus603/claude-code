/**
 * Tests for fromAgentEvent + toCoreMessages + fromCoreMessages — pure
 * boundary helpers in createDeps.ts that adapt the agent runtime's
 * event/message shapes to the SDK surface.
 *
 * fromAgentEvent is the SDK event projector: each agent event arrives
 * tagged with `type` and either projects to a shape SDK consumers
 * understand, or returns undefined (drop the event).
 *
 * Wrong dispatch = SDK consumer (TypeScript SDK, vscode extension) sees
 * malformed events or misses message updates → broken UX.
 */
import { describe, expect, test } from 'bun:test'
import {
  fromAgentEvent,
  fromCoreMessages,
  toCoreMessages,
} from '../createDeps.js'

describe('fromAgentEvent — message events', () => {
  test('message event with nested message field returns inner', () => {
    // Documented: message events carry { type: 'message', message: { ... } }
    // and the inner message has its own `message` field (Anthropic shape).
    // The projector unwraps once.
    const inner = { type: 'assistant', message: { role: 'assistant', content: [] } }
    const r = fromAgentEvent({ type: 'message', message: inner })
    expect(r).toBe(inner)
  })

  test('message event with no message field → undefined', () => {
    expect(fromAgentEvent({ type: 'message' })).toBeUndefined()
  })

  test('message event with null message → undefined', () => {
    expect(fromAgentEvent({ type: 'message', message: null })).toBeUndefined()
  })

  test('message event where message lacks nested .message → undefined', () => {
    // Documented contract: the inner check requires `'message' in msg`,
    // i.e. the inner object must itself have a .message field. If it
    // doesn't (raw payload, type tag only), we drop.
    expect(
      fromAgentEvent({ type: 'message', message: { type: 'noinner' } }),
    ).toBeUndefined()
  })

  test('message event with primitive (string) message → undefined', () => {
    expect(
      fromAgentEvent({ type: 'message', message: 'string' as never }),
    ).toBeUndefined()
  })
})

describe('fromAgentEvent — stream events', () => {
  test('stream event returns the inner event verbatim', () => {
    const innerEvent = { type: 'content_block_start', index: 0 }
    const r = fromAgentEvent({ type: 'stream', event: innerEvent })
    expect(r).toBe(innerEvent)
  })

  test('stream event with undefined event → undefined', () => {
    expect(fromAgentEvent({ type: 'stream' })).toBeUndefined()
  })
})

describe('fromAgentEvent — request_start events', () => {
  test('returns synthetic stream_request_start marker', () => {
    expect(fromAgentEvent({ type: 'request_start' })).toEqual({
      type: 'stream_request_start',
    })
  })

  test('extra fields on input ignored — output is just the marker', () => {
    // Documented contract: request_start synthesizes a fixed-shape marker;
    // any extra fields the caller passes are dropped.
    const r = fromAgentEvent({
      type: 'request_start',
      requestId: 'abc',
      extra: 'data',
    })
    expect(r).toEqual({ type: 'stream_request_start' })
  })
})

describe('fromAgentEvent — done event', () => {
  test('done event → undefined (drop, signals end of stream)', () => {
    expect(fromAgentEvent({ type: 'done' })).toBeUndefined()
  })

  test('done event with extra fields → still undefined', () => {
    expect(
      fromAgentEvent({ type: 'done', usage: { input_tokens: 100 } }),
    ).toBeUndefined()
  })
})

describe('fromAgentEvent — unknown event types', () => {
  test('unknown type → undefined (default branch drops)', () => {
    expect(fromAgentEvent({ type: 'unknown_type' })).toBeUndefined()
  })

  test('empty type → undefined', () => {
    expect(fromAgentEvent({ type: '' })).toBeUndefined()
  })

  test('mistyped (e.g., "Message" capitalized) → undefined', () => {
    // Case-sensitive switch.
    expect(
      fromAgentEvent({
        type: 'Message',
        message: { type: 'x', message: {} },
      } as never),
    ).toBeUndefined()
  })
})

describe('fromAgentEvent — return shape invariants', () => {
  test('returns object or undefined (never null/throws)', () => {
    const samples = [
      { type: 'message' },
      { type: 'message', message: null },
      { type: 'stream' },
      { type: 'request_start' },
      { type: 'done' },
      { type: 'random' },
    ]
    for (const s of samples) {
      const r = fromAgentEvent(s)
      expect(r === undefined || (typeof r === 'object' && r !== null)).toBe(true)
    }
  })
})

// ──────────────────────────────────────────────────────────────────
// toCoreMessages / fromCoreMessages — identity boundary markers.
//
// V7 §11 separates the agent runtime's AgentMessage type from the
// SDK-facing CoreMessage type. They're structurally identical right
// now (the cast is a no-op), but the explicit converters make the
// boundary searchable and let later refactors evolve the shapes
// independently without rewriting every call site.
// ──────────────────────────────────────────────────────────────────

describe('toCoreMessages — identity boundary', () => {
  test('empty array → empty array (same reference)', () => {
    const messages: never[] = []
    expect(toCoreMessages(messages)).toBe(messages as never[])
  })

  test('messages passed through unchanged (reference equality)', () => {
    const messages = [
      { type: 'user', message: { role: 'user', content: 'hi' } },
      { type: 'assistant', message: { role: 'assistant', content: [] } },
    ] as never[]
    expect(toCoreMessages(messages)).toBe(messages)
  })

  test('array contents preserved verbatim', () => {
    const a = { type: 'a' }
    const b = { type: 'b' }
    const r = toCoreMessages([a, b] as never[])
    expect(r[0]).toBe(a)
    expect(r[1]).toBe(b)
  })
})

describe('fromCoreMessages — identity boundary', () => {
  test('empty array → empty array', () => {
    const messages: never[] = []
    expect(fromCoreMessages(messages)).toBe(messages as never[])
  })

  test('messages passed through unchanged', () => {
    const messages = [
      { type: 'user', message: { role: 'user', content: 'hi' } },
    ] as never[]
    expect(fromCoreMessages(messages)).toBe(messages)
  })
})

describe('to/fromCoreMessages — round-trip', () => {
  test('to + from = identity for any input', () => {
    const original = [
      { type: 'a', extra: 1 },
      { type: 'b', nested: { x: 'y' } },
    ] as never[]
    expect(fromCoreMessages(toCoreMessages(original))).toBe(original)
  })
})
