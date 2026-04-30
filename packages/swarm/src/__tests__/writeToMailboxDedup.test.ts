/**
 * Tests for the dedup key used by writeToMailbox to drop retried
 * protocol messages.
 *
 * Background: the previous implementation appended every call
 * unconditionally. A retried `shutdown_request` with the same
 * requestId stacked up four entries in the recipient's inbox; the
 * runner processed the first one but the read-flag race caused the
 * remaining three to become invisible — locking the teammate in
 * "approved but not exiting" limbo. The fix dedupes at the write
 * site: if the inbox already contains an entry with the same
 * (type, requestId) pair, the new write is a no-op.
 *
 * Verified at the helper level (extractDedupKey) since the full
 * writeToMailbox path drags in the swarm runtime bindings; the helper
 * is the actual decision point and exhaustively covers every
 * dedup-relevant message shape.
 */
import { describe, expect, test } from 'bun:test'

import { extractDedupKey } from '../mailbox/index.js'

describe('extractDedupKey — protocol messages with requestId are deduped', () => {
  test('shutdown_request with requestId returns the dedup key', () => {
    const text = JSON.stringify({
      type: 'shutdown_request',
      requestId: 'req-1',
      from: 'team-lead',
      timestamp: 't',
    })
    expect(extractDedupKey(text)).toEqual({
      type: 'shutdown_request',
      requestId: 'req-1',
    })
  })

  test('plan_approval_request with requestId returns the dedup key', () => {
    const text = JSON.stringify({
      type: 'plan_approval_request',
      requestId: 'plan-1',
      from: 'alice',
      plan: '...',
      timestamp: 't',
    })
    expect(extractDedupKey(text)).toEqual({
      type: 'plan_approval_request',
      requestId: 'plan-1',
    })
  })

  test('different requestIds yield different keys', () => {
    const a = extractDedupKey(
      JSON.stringify({ type: 'shutdown_request', requestId: 'r1' }),
    )
    const b = extractDedupKey(
      JSON.stringify({ type: 'shutdown_request', requestId: 'r2' }),
    )
    expect(a).toEqual({ type: 'shutdown_request', requestId: 'r1' })
    expect(b).toEqual({ type: 'shutdown_request', requestId: 'r2' })
  })

  test('different types with same requestId yield different keys', () => {
    const a = extractDedupKey(
      JSON.stringify({ type: 'shutdown_request', requestId: 'r1' }),
    )
    const b = extractDedupKey(
      JSON.stringify({ type: 'plan_approval_request', requestId: 'r1' }),
    )
    expect(a).toEqual({ type: 'shutdown_request', requestId: 'r1' })
    expect(b).toEqual({ type: 'plan_approval_request', requestId: 'r1' })
  })
})

describe('extractDedupKey — non-keyed messages return null', () => {
  test('plain text returns null', () => {
    expect(extractDedupKey('hello there')).toBeNull()
  })

  test('JSON without type+requestId returns null', () => {
    // idle_notification has type but no requestId — caller decides
    // whether duplicates are wanted.
    expect(
      extractDedupKey(
        JSON.stringify({
          type: 'idle_notification',
          from: 'alice',
          timestamp: 't',
        }),
      ),
    ).toBeNull()
  })

  test('JSON with requestId but no type returns null', () => {
    expect(
      extractDedupKey(JSON.stringify({ requestId: 'r1', payload: 'x' })),
    ).toBeNull()
  })

  test('non-string type returns null', () => {
    expect(
      extractDedupKey(JSON.stringify({ type: 42, requestId: 'r1' })),
    ).toBeNull()
  })

  test('non-string requestId returns null', () => {
    expect(
      extractDedupKey(JSON.stringify({ type: 'shutdown_request', requestId: 42 })),
    ).toBeNull()
  })

  test('malformed JSON returns null', () => {
    expect(extractDedupKey('{not json')).toBeNull()
  })

  test('empty string returns null', () => {
    expect(extractDedupKey('')).toBeNull()
  })

  test('JSON null returns null', () => {
    expect(extractDedupKey('null')).toBeNull()
  })

  test('JSON array returns null (not an object)', () => {
    expect(extractDedupKey('["shutdown_request","r1"]')).toBeNull()
  })
})
