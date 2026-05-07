/**
 * Peer-UID lookup for Unix-domain sockets. ant 5163.js TF3/AF3/zF3 —
 * resolves the connecting process's effective uid via getsockopt
 * SO_PEERCRED (Linux) or LOCAL_PEERCRED (macOS), so the daemon can
 * reject control-socket connections from a different uid (sudo
 * footgun, host-shared filesystems, etc.).
 *
 * Returns:
 *   - null when the platform doesn't support uid lookup or when the
 *     lookup fails (best-effort — we accept the connection if we
 *     can't verify, matching ant). The caller treats null as 'not
 *     verifiable, accept'.
 *   - a number when peer uid was successfully resolved.
 *
 * Windows is unsupported (named pipes have a different ACL model;
 * ant returns null too).
 *
 * @dynamicRequire
 */

import type { Socket } from 'node:net'

import { logEvent } from '@claude-code/local-observability'

/**
 * Get the connecting peer's uid for a Unix-domain socket. Returns null
 * on any failure. Errors are logged but don't propagate — verifying
 * the peer is best-effort.
 */
export function getPeerUid(socket: Socket): number | null {
  if (process.platform === 'win32') return null
  // socket._handle.fd is the underlying file descriptor. Node's public
  // API doesn't expose it; we reach in like ant does.
  const handle = (socket as unknown as { _handle?: { fd?: number } })._handle
  const fd = typeof handle?.fd === 'number' ? handle.fd : -1
  if (fd < 0) return null
  try {
    if (process.platform === 'darwin') return getPeerUidMacOS(fd)
    return getPeerUidLinux(fd)
  } catch (e) {
    logEvent('tengu_daemon_peer_uid_lookup_failed', {
      errno: (e as NodeJS.ErrnoException).code ?? 'unknown',
      msg: (e as Error).message.slice(0, 80),
    })
    return null
  }
}

/**
 * Linux SO_PEERCRED. Returns sockaddr struct ucred { pid; uid; gid }.
 * uid is at byte offset 4. Optionlevel SOL_SOCKET=1, optname SO_PEERCRED=17.
 */
function getPeerUidLinux(fd: number): number | null {
  const ffi = loadGetsockopt()
  if (!ffi) return null
  const buf = new Uint8Array(12) // sizeof(struct ucred)
  const len = new Uint32Array([12])
  const r = ffi.getsockopt(fd, 1, 17, buf, len)
  if (r !== 0) return null
  return new DataView(buf.buffer).getUint32(4, true)
}

/**
 * macOS LOCAL_PEERCRED. Returns xucred struct; uid is at byte offset 4.
 * Option level 0 (SOL_LOCAL) on macOS, optname LOCAL_PEERCRED=1.
 */
function getPeerUidMacOS(fd: number): number | null {
  const ffi = loadGetsockopt()
  if (!ffi) return null
  const buf = new Uint8Array(76) // sizeof(struct xucred) — over-allocate
  const len = new Uint32Array([76])
  // SOL_LOCAL = 0, LOCAL_PEERCRED = 0x001 on macOS
  const r = ffi.getsockopt(fd, 0, 1, buf, len)
  if (r !== 0) return null
  return new DataView(buf.buffer).getUint32(4, true)
}

interface GetsockoptFFI {
  getsockopt: (
    fd: number,
    level: number,
    optname: number,
    buf: Uint8Array,
    len: Uint32Array,
  ) => number
}

let cachedFFI: GetsockoptFFI | null | undefined

function loadGetsockopt(): GetsockoptFFI | null {
  if (cachedFFI !== undefined) return cachedFFI
  try {
    // bun:ffi is bun-only. ccb runs only on bun (build target=bun) so
    // this is safe; node would throw at import time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { dlopen, FFIType, ptr } = require('bun:ffi') as typeof import('bun:ffi')
    const libname = process.platform === 'darwin' ? 'libSystem.dylib' : 'libc.so.6'
    const lib = dlopen(libname, {
      getsockopt: {
        args: [
          FFIType.i32,
          FFIType.i32,
          FFIType.i32,
          FFIType.ptr,
          FFIType.ptr,
        ],
        returns: FFIType.i32,
      },
    })
    cachedFFI = {
      getsockopt: (fd, level, optname, buf, len) =>
        lib.symbols.getsockopt(fd, level, optname, ptr(buf), ptr(len)) as number,
    }
    return cachedFFI
  } catch {
    cachedFFI = null
    return null
  }
}

/**
 * Check if the connecting peer's uid matches the daemon's uid.
 * Returns null if access is allowed (peer matches OR can't be
 * verified); returns an error message string if access should be
 * rejected. ant 5163.js RFK exact behavior.
 */
export function checkPeerUid(socket: Socket): string | null {
  const myUid = process.getuid?.()
  if (myUid == null) return null
  const peerUid = getPeerUid(socket)
  if (peerUid == null) return null
  if (peerUid === myUid) return null
  return `permission denied: connecting uid ${peerUid} != daemon uid ${myUid} (retry without sudo, or as the daemon owner)`
}
