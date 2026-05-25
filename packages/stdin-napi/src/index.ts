/**
 * stdin-napi — in-process TTY stdin reader, exposed as a Bun-loadable native
 * module. Backed by the rust crate at ../native (termios raw-mode + blocking
 * read on a dedicated thread + ThreadsafeFunction delivery).
 *
 * ## Why
 *
 * Bun standalone (`bun build --compile`) inherits an unpatched libuv whose TTY
 * stdin poll stops re-arming after an Ink mount→unmount→re-mount cycle —
 * `process.stdin`'s 'data'/'readable' events go silent while the user types.
 * ant avoids this with a private bun fork (bun-internal) we can't obtain. This
 * reader bypasses libuv entirely by reading the tty fd directly on its own
 * thread, so the poll bug can't reach it. Same NAPI-bypass pattern as
 * ripgrep-napi.
 *
 * ## Resolution
 *
 * bun's bundler detects literal `require('./vendor/<plat>/...node')` calls and
 * embeds the .node into the standalone binary's __BUN segment. Same
 * load-bearing pattern as packages/ripgrep-napi/src/index.ts — keep these as
 * plain string literals; templates / variables / helpers defeat the bundler's
 * static analysis and the .node won't ship.
 *
 * ## API
 *
 *   isReaderSupported()                 → boolean   (false on win32 / non-tty)
 *   startReader(useDevTty, onChunk)     → ReaderHandle
 *   ReaderHandle.stop()                             (idempotent; restores termios)
 *
 * `onChunk` receives a Buffer per read, trimmed to a UTF-8 boundary. Feed it
 * straight into ink's App.handleData (which accepts Buffer | string).
 */

interface ReaderHandle {
  stop(): void
}

interface NativeBinding {
  startReader(
    useDevTty: boolean,
    onChunk: (err: Error | null, chunk: Buffer) => void,
  ): ReaderHandle
  activeReaderCount(): number
}

/** Number of live rust reader threads. >1 means a stale reader leaked. */
export function activeReaderCount(): number {
  const n = load()
  return n ? n.activeReaderCount() : 0
}

let cached: NativeBinding | null = null
let loadError: Error | null = null

function load(): NativeBinding | null {
  if (cached !== null) return cached
  if (loadError !== null) return null

  // Plain literal require() calls so bun's bundler embeds each .node.
  let mod: unknown
  try {
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/arm64-darwin/stdin.node')
    } else if (process.platform === 'darwin' && process.arch === 'x64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/x64-darwin/stdin.node')
    } else if (process.platform === 'linux' && process.arch === 'arm64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/arm64-linux/stdin.node')
    } else if (process.platform === 'linux' && process.arch === 'x64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/x64-linux/stdin.node')
    } else if (process.platform === 'win32' && process.arch === 'x64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/x64-win32/stdin.node')
    } else {
      loadError = new Error(
        `stdin-napi: unsupported platform ${process.platform}-${process.arch}`,
      )
      return null
    }
  } catch (e) {
    loadError = new Error(
      `stdin-napi: failed to load native module for ${process.platform}-${process.arch}: ${(e as Error).message}`,
    )
    return null
  }

  cached = mod as NativeBinding
  return cached
}

/**
 * Whether the native reader can be used on this platform. Returns false on
 * win32 (no termios — the rust side is a stub) and if the .node failed to
 * load. Callers should fall back to the standard process.stdin path when this
 * is false.
 */
export function isReaderSupported(): boolean {
  // win32: the native module loads but start_reader returns an error. Treat as
  // unsupported up front so callers don't even try.
  if (process.platform === 'win32') return false
  return load() !== null
}

/**
 * Start the native TTY reader.
 *
 * @param redirectFd0 when true (the FleetView path), dup(0) the real tty for
 *   the reader then dup2(/dev/null,0) so Bun's libuv stops stealing tty bytes;
 *   stop() restores the real tty onto fd 0 (process.stdin revived, never
 *   destroyed). When false, read fd 0 directly (only safe if nothing else
 *   reads fd 0). Prefer true.
 * @param onChunk called with each Buffer chunk (UTF-8 boundary trimmed).
 * @returns a handle whose stop() tears the reader down and restores termios.
 * @throws if the native module is unavailable or the fd is not a tty.
 */
export function startReader(
  redirectFd0: boolean,
  onChunk: (chunk: Buffer) => void,
): ReaderHandle {
  const native = load()
  if (native === null) {
    throw loadError ?? new Error('stdin-napi: native module unavailable')
  }
  return native.startReader(redirectFd0, (err, chunk) => {
    if (!err) onChunk(chunk)
  })
}

export type { ReaderHandle }
