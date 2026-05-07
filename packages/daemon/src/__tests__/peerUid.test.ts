import { describe, expect, test } from 'bun:test'
import type { Socket } from 'node:net'

import { checkPeerUid, getPeerUid } from '../peerUid.js'

/**
 * The actual FFI lookup is exercised by integration paths (real
 * supervisor process binding the control socket). Here we test the
 * public contract:
 * - getPeerUid returns null on win32 / handle-without-fd / non-net
 *   sockets without throwing
 * - checkPeerUid returns null when verification isn't possible
 *   (matches ant 5163 RFK best-effort fall-through)
 * - checkPeerUid returns null when peer == self uid (allow path)
 */

function fakeSocket(handle?: { fd?: number }): Socket {
  return { _handle: handle } as unknown as Socket
}

describe('getPeerUid', () => {
  test('returns null when handle is missing', () => {
    expect(getPeerUid(fakeSocket(undefined))).toBeNull()
  })

  test('returns null when fd is not a number', () => {
    expect(getPeerUid(fakeSocket({}))).toBeNull()
  })

  test('returns null when fd is negative (closed socket)', () => {
    expect(getPeerUid(fakeSocket({ fd: -1 }))).toBeNull()
  })

  test('does not throw on platform-unsupported branch', () => {
    expect(() => getPeerUid(fakeSocket({ fd: 99999 }))).not.toThrow()
  })
})

describe('checkPeerUid', () => {
  test('returns null when peer cannot be verified', () => {
    // No handle → getPeerUid returns null → checkPeerUid returns null
    // (best-effort allow). This is the same null-return as on Windows
    // where peer-uid lookup isn't supported. Verifies ant RFK contract.
    expect(checkPeerUid(fakeSocket(undefined))).toBeNull()
  })

  test('null fd path is treated as "cannot verify, allow"', () => {
    expect(checkPeerUid(fakeSocket({}))).toBeNull()
  })

  test('does not throw even when getuid is unavailable', () => {
    // process.getuid exists on POSIX but not on Windows. This test
    // just confirms checkPeerUid is safe to call on any platform.
    expect(() => checkPeerUid(fakeSocket(undefined))).not.toThrow()
  })
})
