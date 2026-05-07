/**
 * `ccb attach <short>` — interactive bridge to a PTY-mode bg session.
 *
 * Mirrors ant 4649.js aM3 + Yg client side. Connects to the PTY
 * host's Unix socket via `createPtyAdopter`, sets local TTY into raw
 * mode, forwards stdin keystrokes as DATA frames, paints DATA frames
 * back to stdout, and propagates SIGWINCH as resize ctrl frames.
 *
 * Detach key: Ctrl+Q (0x11). Pressing it disposes the adopter and
 * exits the client process WITHOUT killing the bg session — the host
 * keeps running, ready for a future re-attach. This matches ant's
 * detach semantics (clients are decoupled from session lifecycle).
 *
 * Exit code:
 *   0 — clean detach (Ctrl+Q) or session exited normally (code 0)
 *   non-zero — session exited with that code
 *
 * @dynamicRequire
 */

import { logEvent } from '@claude-code/local-observability'
import { createDecModeTracker } from './decModeTracker.js'
import { createPtyAdopter, type PtyAdopter } from './ptyAdopter.js'

const DETACH_KEY_BYTE = 0x11 // Ctrl+Q

/**
 * Open a PTY socket attach session. Resolves when the bg session
 * exits OR the user presses Ctrl+Q. Caller is responsible for
 * confirming the socket path exists; we'll surface a clear error if
 * connect fails.
 */
export async function runAttach(
  socketPath: string,
  short: string,
): Promise<void> {
  let adopter: PtyAdopter | undefined
  let restoreTty: (() => void) | undefined
  let exitCode = 0
  let detached = false
  const startedAt = Date.now()
  let firstFrameAt = 0
  const decModes = createDecModeTracker()
  logEvent('tengu_bg_attach', { short })

  // Local TTY raw-mode setup. Without this, the local terminal would
  // do its own line-buffering + Ctrl+C → SIGINT → kill the attach
  // client's process (which we don't want). Raw mode also lets us
  // detect the Ctrl+Q sentinel.
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    const wasRaw = process.stdin.isRaw
    process.stdin.setRawMode(true)
    process.stdin.resume()
    restoreTty = () => {
      try {
        if (process.stdin.setRawMode) process.stdin.setRawMode(wasRaw)
      } catch {
        // best-effort
      }
    }
  }

  // Open adopter against the host socket.
  adopter = createPtyAdopter(socketPath)

  // Render incoming PTY output to local stdout. ant 4638.js Yg: track
  // DEC private modes so detach can restore local terminal state.
  const dataSub = adopter.onData(chunk => {
    if (firstFrameAt === 0) {
      firstFrameAt = Date.now()
      logEvent('tengu_bg_attach_first_frame', {
        ms: String(firstFrameAt - startedAt),
      })
    }
    decModes.feed(chunk)
    process.stdout.write(chunk)
  })

  // Resolve when the host signals exit OR we detach.
  const exitPromise = new Promise<void>(resolve => {
    const exitSub = adopter!.onExit(info => {
      exitCode = info.exitCode === -1 ? 1 : info.exitCode
      exitSub.dispose()
      resolve()
    })
  })

  // Forward stdin keystrokes to the PTY. Look for the detach byte.
  const onStdin = (chunk: Buffer): void => {
    // Scan for Ctrl+Q. Pass everything before the sentinel through;
    // anything after is dropped because we're detaching.
    const idx = chunk.indexOf(DETACH_KEY_BYTE)
    if (idx === -1) {
      adopter!.write(chunk.toString('binary'))
      return
    }
    if (idx > 0) {
      adopter!.write(chunk.subarray(0, idx).toString('binary'))
    }
    detached = true
    process.stdin.removeListener('data', onStdin)
  }
  process.stdin.on('data', onStdin)

  // Resize propagation: when the local terminal changes size, send
  // a resize ctrl frame so the host PTY matches.
  const initialResize = (): void => {
    const cols = process.stdout.columns
    const rows = process.stdout.rows
    if (cols && rows) adopter!.resize(cols, rows)
  }
  initialResize()
  const onResize = (): void => initialResize()
  process.stdout.on('resize', onResize)

  // Wait for either exit or detach.
  const detachPromise = new Promise<void>(resolve => {
    const checker = setInterval(() => {
      if (detached) {
        clearInterval(checker)
        resolve()
      }
    }, 25)
    checker.unref()
  })

  await Promise.race([exitPromise, detachPromise])

  // ant 4638.js: emit DEC mode restore so the local terminal isn't
  // stuck in mouse-mode / alt-screen / bracketed-paste etc.
  const restore = decModes.restoreSequence()
  if (restore) process.stdout.write(restore)

  // Cleanup.
  dataSub.dispose()
  process.stdout.removeListener('resize', onResize)
  process.stdin.removeListener('data', onStdin)
  if (process.stdin.pause) process.stdin.pause()
  adopter.dispose()
  restoreTty?.()

  const outcome = detached ? 'detached' : 'exited'
  logEvent('tengu_bg_attach_outcome', {
    outcome,
    got_first_frame: String(firstFrameAt > 0),
    ms: String(Date.now() - startedAt),
  })

  if (detached) {
    process.stderr.write(`\n[detached from ${short} — session keeps running]\n`)
    process.exit(0)
  }
  process.stderr.write(`\n[session ${short} exited with code ${exitCode}]\n`)
  process.exit(exitCode)
}
