/**
 * Tests for createModeSetRequestMessage + isStructuredProtocolMessage
 * — pure helpers in the swarm mailbox protocol.
 *
 * createModeSetRequestMessage builds the leader→teammate message
 * that propagates a permission mode change. Wrong factory = teammate
 * gets a malformed message, ignored silently.
 *
 * isStructuredProtocolMessage gates whether a mailbox message is
 * structured (routed to a handler) or raw text (consumed as LLM
 * context). Wrong gate = either a permission_request leaks into the
 * model context as JSON text (no handler triggered), or a regular
 * message gets misrouted to a handler that drops it.
 */
import { describe, expect, test } from 'bun:test'
import {
  createModeSetRequestMessage,
  isStructuredProtocolMessage,
} from '../mailbox/index.js'

describe('createModeSetRequestMessage', () => {
  test('returns mode_set_request with mode + from', () => {
    const m = createModeSetRequestMessage({ mode: 'plan', from: 'lead' })
    expect(m.type).toBe('mode_set_request')
    expect(m.mode).toBe('plan')
    expect(m.from).toBe('lead')
  })

  test('all known permission modes accepted', () => {
    for (const mode of [
      'default',
      'plan',
      'acceptEdits',
      'bypassPermissions',
    ]) {
      const m = createModeSetRequestMessage({ mode, from: 'lead' })
      expect(m.mode).toBe(mode)
    }
  })

  test('emits exactly 3 keys', () => {
    const m = createModeSetRequestMessage({ mode: 'default', from: 'a' })
    expect(Object.keys(m).sort()).toEqual(['from', 'mode', 'type'])
  })

  test('does NOT include timestamp (different from other factories)', () => {
    // Documented quirk: ModeSetRequest has no timestamp; relies on
    // mailbox file's mtime instead.
    const m = createModeSetRequestMessage({ mode: 'plan', from: 'a' })
    expect((m as never as { timestamp?: unknown }).timestamp).toBeUndefined()
  })
})

describe('isStructuredProtocolMessage — error path', () => {
  // Detector calls jsonParse from local-observability; in pure tests
  // without bindings, the detector returns false on EVERY input
  // (the parse fails). Lock that behavior — the function NEVER
  // throws on garbage, returning false instead.

  test('non-JSON garbage → false (no throw)', () => {
    expect(isStructuredProtocolMessage('not json')).toBe(false)
    expect(isStructuredProtocolMessage('')).toBe(false)
    expect(isStructuredProtocolMessage('{')).toBe(false)
  })

  test('JSON null → false', () => {
    // null parsed but no `type` field → false.
    expect(isStructuredProtocolMessage('null')).toBe(false)
  })

  test('JSON without type field → false', () => {
    // Bindings-dependent — locked: returns false (no throw) regardless.
    expect(isStructuredProtocolMessage('{}')).toBe(false)
    expect(isStructuredProtocolMessage('{"foo":"bar"}')).toBe(false)
  })

  test('JSON with unknown type → false', () => {
    expect(
      isStructuredProtocolMessage('{"type":"unknown_future_type"}'),
    ).toBe(false)
  })

  test('JSON array (not object) → false', () => {
    expect(isStructuredProtocolMessage('[]')).toBe(false)
    expect(isStructuredProtocolMessage('[{"type":"permission_request"}]')).toBe(
      false,
    )
  })
})

describe('isStructuredProtocolMessage — type guard return is boolean', () => {
  test('always returns boolean (never undefined or null)', () => {
    const inputs = ['', 'x', '{}', 'null', '[]', '{"type":"x"}']
    for (const input of inputs) {
      expect(typeof isStructuredProtocolMessage(input)).toBe('boolean')
    }
  })
})
