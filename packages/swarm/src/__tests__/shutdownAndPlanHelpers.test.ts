/**
 * Tests for shutdown + plan-approval mailbox factory helpers — pure
 * factories used by the swarm coordinator/teammate dance to construct
 * graceful shutdown / plan-approval control messages.
 *
 * The detector functions (isShutdownRequest, isPlanApprovalRequest,
 * etc.) call jsonParse from local-observability which requires
 * bindings to be installed. In pure isolated test mode, those return
 * null. Detector tests deferred to integration suite.
 *
 * Wrong factory output = teammate sends a malformed shutdown that
 * gets dropped silently → leader thinks teammate is alive when it's
 * not.
 */
import { describe, expect, test } from 'bun:test'
import {
  createShutdownApprovedMessage,
  createShutdownRejectedMessage,
  createShutdownRequestMessage,
  isPlanApprovalRequest,
  isPlanApprovalResponse,
  isShutdownApproved,
  isShutdownRejected,
  isShutdownRequest,
} from '../mailbox/index.js'

describe('createShutdownRequestMessage', () => {
  test('returns shutdown_request type with all fields', () => {
    const m = createShutdownRequestMessage({
      requestId: 'shutdown-123',
      from: 'team-lead',
      reason: 'work complete',
    })
    expect(m.type).toBe('shutdown_request')
    expect(m.requestId).toBe('shutdown-123')
    expect(m.from).toBe('team-lead')
    expect(m.reason).toBe('work complete')
  })

  test('reason is optional', () => {
    const m = createShutdownRequestMessage({
      requestId: 'shutdown-1',
      from: 'lead',
    })
    expect(m.reason).toBeUndefined()
  })

  test('timestamp is ISO format', () => {
    const m = createShutdownRequestMessage({ requestId: 'x', from: 'lead' })
    expect(m.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  test('each call generates a fresh timestamp', async () => {
    const m1 = createShutdownRequestMessage({ requestId: 'x', from: 'a' })
    await new Promise(r => setTimeout(r, 5))
    const m2 = createShutdownRequestMessage({ requestId: 'x', from: 'a' })
    // Either equal or m2 > m1 — never m2 < m1.
    expect(m1.timestamp <= m2.timestamp).toBe(true)
  })
})

describe('createShutdownApprovedMessage', () => {
  test('returns shutdown_approved with all fields', () => {
    const m = createShutdownApprovedMessage({
      requestId: 'shutdown-1',
      from: 'worker-a',
      paneId: '%5',
      backendType: 'tmux',
    })
    expect(m.type).toBe('shutdown_approved')
    expect(m.requestId).toBe('shutdown-1')
    expect(m.from).toBe('worker-a')
    expect(m.paneId).toBe('%5')
    expect(m.backendType).toBe('tmux')
  })

  test('paneId and backendType are optional', () => {
    const m = createShutdownApprovedMessage({
      requestId: 'shutdown-1',
      from: 'worker-a',
    })
    expect(m.paneId).toBeUndefined()
    expect(m.backendType).toBeUndefined()
  })

  test('timestamp is ISO format', () => {
    const m = createShutdownApprovedMessage({ requestId: 'x', from: 'y' })
    expect(m.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  test('all 3 backend types accepted', () => {
    expect(
      createShutdownApprovedMessage({
        requestId: 'a',
        from: 'b',
        backendType: 'tmux',
      }).backendType,
    ).toBe('tmux')
    expect(
      createShutdownApprovedMessage({
        requestId: 'a',
        from: 'b',
        backendType: 'iterm2',
      }).backendType,
    ).toBe('iterm2')
    expect(
      createShutdownApprovedMessage({
        requestId: 'a',
        from: 'b',
        backendType: 'in-process',
      }).backendType,
    ).toBe('in-process')
  })
})

describe('createShutdownRejectedMessage', () => {
  test('returns shutdown_rejected with reason', () => {
    const m = createShutdownRejectedMessage({
      requestId: 'shutdown-1',
      from: 'worker-a',
      reason: 'still working on task',
    })
    expect(m.type).toBe('shutdown_rejected')
    expect(m.reason).toBe('still working on task')
    expect(m.requestId).toBe('shutdown-1')
    expect(m.from).toBe('worker-a')
  })

  test('reason is required (different from request)', () => {
    // Documented contract: shutdown_request can omit reason but
    // shutdown_rejected requires one (caller must explain why).
    const m = createShutdownRejectedMessage({
      requestId: 'x',
      from: 'y',
      reason: 'busy',
    })
    expect(typeof m.reason).toBe('string')
  })
})

describe('factory output: type discriminator is unique per factory', () => {
  test('each factory emits a distinct `type` literal', () => {
    const req = createShutdownRequestMessage({ requestId: 'x', from: 'y' })
    const apr = createShutdownApprovedMessage({ requestId: 'x', from: 'y' })
    const rej = createShutdownRejectedMessage({
      requestId: 'x',
      from: 'y',
      reason: 'z',
    })
    expect(req.type).toBe('shutdown_request')
    expect(apr.type).toBe('shutdown_approved')
    expect(rej.type).toBe('shutdown_rejected')
    // All 3 are unique.
    expect(new Set([req.type, apr.type, rej.type]).size).toBe(3)
  })
})

describe('detector return path on non-JSON (no bindings required)', () => {
  // The error-catch path returns null — exercising it doesn't need
  // bindings. Lock that detectors NEVER throw on garbage input.
  const detectors = [
    isShutdownRequest,
    isShutdownApproved,
    isShutdownRejected,
    isPlanApprovalRequest,
    isPlanApprovalResponse,
  ]

  test.each(detectors.map(fn => [fn.name, fn] as const))(
    '%s on non-JSON returns null (does NOT throw)',
    (_name, fn) => {
      expect(fn('not json')).toBeNull()
      expect(fn('')).toBeNull()
      expect(fn('null')).toBeNull()
    },
  )
})
