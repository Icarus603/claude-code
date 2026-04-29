/**
 * Tests for mailbox message helpers — JSON-encoded messages between
 * agents in the team.
 *
 * Wrong type discrimination = leader interprets a worker's tool-use
 * permission request as an idle notification (or vice versa) and the
 * worker hangs forever waiting for a response.
 *
 * formatTeammateMessages produces the XML attachment surface that
 * appears in the leader's prompt — wrong escaping means worker's text
 * containing `</teammate-message>` could close the wrapper early and
 * confuse the model.
 */
import { describe, expect, test } from 'bun:test'
import {
  createIdleNotification,
  formatTeammateMessages,
  isIdleNotification,
  isPermissionRequest,
  isPermissionResponse,
} from '../mailbox/index.js'

describe('createIdleNotification — message shape', () => {
  test('minimal call (just agentId) produces valid notification', () => {
    const m = createIdleNotification('worker-1')
    expect(m.type).toBe('idle_notification')
    expect(m.from).toBe('worker-1')
    expect(typeof m.timestamp).toBe('string')
    // Round-trips through Date
    expect(new Date(m.timestamp).toISOString()).toBe(m.timestamp)
  })

  test('with all options: each field flows through', () => {
    const m = createIdleNotification('w1', {
      idleReason: 'failed',
      summary: 'config sync failed',
      completedTaskId: 't1',
      completedStatus: 'failed',
      failureReason: 'timeout',
    })
    expect(m.idleReason).toBe('failed')
    expect(m.summary).toBe('config sync failed')
    expect(m.completedTaskId).toBe('t1')
    expect(m.completedStatus).toBe('failed')
    expect(m.failureReason).toBe('timeout')
  })

  test('partial options: omitted fields stay undefined', () => {
    const m = createIdleNotification('w1', { idleReason: 'available' })
    expect(m.idleReason).toBe('available')
    expect(m.summary).toBeUndefined()
    expect(m.completedTaskId).toBeUndefined()
  })
})

describe('isIdleNotification — error path (no bindings)', () => {
  // Same caveat as is*Permission* — jsonParse is missingBinding in
  // unit tests, so all paths return null via the catch block.
  test('non-JSON text → null (no throw)', () => {
    expect(isIdleNotification('not json')).toBeNull()
  })

  test('empty string → null', () => {
    expect(isIdleNotification('')).toBeNull()
  })

  test('valid JSON without bindings → null', () => {
    const json = JSON.stringify(createIdleNotification('w1'))
    expect(isIdleNotification(json)).toBeNull()
  })
})

describe('isPermissionRequest / isPermissionResponse — error path (no bindings)', () => {
  // The is*Permission* functions go through `jsonParse` from
  // appRuntime which is a `missingBinding` placeholder by default.
  // Without binding installation (which would drag in the full host),
  // jsonParse throws — caught by the try/catch and the function
  // returns null. Lock that error-path behavior here.

  test('non-JSON → null for both checks (no throw)', () => {
    expect(isPermissionRequest('not json')).toBeNull()
    expect(isPermissionResponse('not json')).toBeNull()
  })

  test('empty string → null', () => {
    expect(isPermissionRequest('')).toBeNull()
    expect(isPermissionResponse('')).toBeNull()
  })

  test('valid JSON without bindings → null (jsonParse throws, caught)', () => {
    // Documented: in unit-test context, jsonParse is the missing-binding
    // sentinel; the try/catch in is* functions absorbs the throw and
    // returns null. This covers both the "wrong type" path AND the
    // "binding not installed" path with a single safe behavior.
    const json = JSON.stringify({
      type: 'permission_request',
      request_id: 'r1',
      agent_id: 'a1',
      tool_name: 'Bash',
      tool_use_id: 't1',
    })
    expect(isPermissionRequest(json)).toBeNull()
    expect(isPermissionResponse(json)).toBeNull()
  })
})

describe('formatTeammateMessages — XML wrapping', () => {
  test('empty list → empty string', () => {
    expect(formatTeammateMessages([])).toBe('')
  })

  test('single message wrapped in tag with teammate_id attr', () => {
    const result = formatTeammateMessages([
      { from: 'alice', text: 'hello', timestamp: '2026-04-30T00:00:00Z' },
    ])
    expect(result).toContain('teammate_id="alice"')
    expect(result).toContain('hello')
    expect(result).toMatch(/^<teammate-message[^>]*>\nhello\n<\/teammate-message>$/)
  })

  test('color attr included when present', () => {
    const result = formatTeammateMessages([
      {
        from: 'a',
        text: 'x',
        timestamp: 'now',
        color: 'red',
      },
    ])
    expect(result).toContain('color="red"')
  })

  test('summary attr included when present', () => {
    const result = formatTeammateMessages([
      { from: 'a', text: 'x', timestamp: 'now', summary: 'short' },
    ])
    expect(result).toContain('summary="short"')
  })

  test('multiple messages joined by double newline', () => {
    const result = formatTeammateMessages([
      { from: 'a', text: 'one', timestamp: 'now' },
      { from: 'b', text: 'two', timestamp: 'now' },
    ])
    const parts = result.split('\n\n')
    expect(parts).toHaveLength(2)
    expect(parts[0]).toContain('one')
    expect(parts[1]).toContain('two')
  })

  test('text content NOT escaped — `</teammate-message>` in body would close early', () => {
    // DOCUMENTED LIMITATION: the formatter doesn't HTML-escape body
    // text. A worker emitting "</teammate-message>" closes the wrapper
    // early. Callers should sanitize before passing to this function,
    // or trust workers (which is the current default).
    const result = formatTeammateMessages([
      { from: 'a', text: '</teammate-message>', timestamp: 'now' },
    ])
    // Document the un-escaped output. If we ever add escaping, this
    // test fails and forces a deliberate update.
    expect(result).toContain('</teammate-message>\n</teammate-message>')
  })
})
