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
 * APC detach sentinel — ant 4176.js `aNH = "\x1b_cc-daemon-detach\x1b\\"`.
 * Emitted by the inner REPL's `$1H()` (4177.js) when the user presses
 * left-arrow on an empty prompt while running as a bg session. runAttach
 * scans incoming PTY data for it, paints any pre-sentinel output, then
 * detaches without killing the bg worker.
 *
 * APC = Application Program Command: ESC `_` <payload> ESC `\` (ST).
 */
const DETACH_APC_SENTINEL = Buffer.from('\x1b_cc-daemon-detach\x1b\\')

/**
 * `PzH()` equivalent from ant 2281.js — written to stdout when the
 * attach client first connects (and caller is NOT already in alt-screen):
 *   Go_ = \x1b[?1049h   ALT_SCREEN_CLEAR set (enter alt, clear scrollback)
 *   qG  = \x1b[2J       Clear entire screen
 *   _f  = \x1b[H        Move cursor to home
 * (`Fl()` for kitty keyboard is omitted — ccb doesn't ship a kitty kbd
 * protocol decoder, so emitting kitty CSI would corrupt later key parse.)
 */
const ALT_SCREEN_ENTER = '\x1b[?1049h\x1b[2J\x1b[H'

/**
 * `KE()` equivalent from ant 2281.js — written on detach when not
 * alreadyInAlt:
 *   Ss   = \x1b[<u      disable kitty keyboard protocol  (no-op if not in)
 *   qh9  = \x1b[?1049l  ALT_SCREEN_CLEAR reset (exit alt-screen)
 *   v9H  = \x1b[>4m     disable xterm modifyOtherKeys mode
 */
const ALT_SCREEN_EXIT = '\x1b[<u\x1b[?1049l\x1b[>4m'

/**
 * Longest-suffix-prefix match. Returns the length `k` such that the last
 * `k` bytes of `buf` equal the first `k` bytes of `needle` — used to
 * detect the start of a sentinel that straddles a chunk boundary.
 *
 * Source: ant 4767.js `Pg8`.
 */
function suffixMatchLen(buf: Buffer, needle: Buffer): number {
  const max = Math.min(buf.length, needle.length - 1)
  outer: for (let k = max; k > 0; k--) {
    const start = buf.length - k
    for (let i = 0; i < k; i++) {
      if (buf[start + i] !== needle[i]) continue outer
    }
    return k
  }
  return 0
}
/** ant 5164.js $F3 default — first-frame stall warning threshold. */
const ATTACH_STALL_THRESHOLD_MS = 10_000
/** Hard timeout after which we fire stall_gave_up + exit. */
const ATTACH_STALL_GAVE_UP_MS = 30_000

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
    restoreTty = () => {
      try {
        if (process.stdin.setRawMode) process.stdin.setRawMode(wasRaw)
      } catch {
        // best-effort
      }
    }
  }

  // Alt-screen ENTER is handled by the caller (agentsFleet loop) so
  // the swap brackets the unmount-FleetView → spawn-runAttach gap.
  // For the standalone `ccb attach <short>` CLI, the caller is the
  // user's shell and the inner REPL's own alt-screen toggle is what
  // the user sees — we write ALT_SCREEN_ENTER below as a fallback
  // only when stdin/stdout look like a TTY but no caller-managed
  // swap has happened yet (heuristic: `CCB_ATTACH_OWNED_ALT_SCREEN`
  // env set by the loop).
  if (!process.env.CCB_ATTACH_OWNED_ALT_SCREEN) {
    process.stdout.write(ALT_SCREEN_ENTER)
  }

  // Open adopter against the host socket.
  adopter = createPtyAdopter(socketPath)

  // Forward stdin keystrokes to the PTY. Source: ant 4767.js Md uses
  // 'readable' + .read() (paused mode) NOT 'data' (flowing mode) — Ink
  // had set encoding to utf8 and uses 'readable' too, so we mirror to
  // avoid mode-switching races where bytes get stuck in the buffer.
  const handleByteChunk = (chunkBuf: Buffer): void => {
    // Scan for Ctrl+Q. Pass everything before the sentinel through;
    // anything after is dropped because we're detaching.
    const idx = chunkBuf.indexOf(DETACH_KEY_BYTE)
    if (idx === -1) {
      adopter!.write(chunkBuf.toString('binary'))
      return
    }
    if (idx > 0) {
      adopter!.write(chunkBuf.subarray(0, idx).toString('binary'))
    }
    detached = true
    process.stdin.removeListener('readable', onReadable)
  }
  const onReadable = (): void => {
    let chunk: Buffer | string | null
    while ((chunk = process.stdin.read() as Buffer | string | null) !== null) {
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as string, 'utf8')
      handleByteChunk(buf)
    }
  }
  process.stdin.on('readable', onReadable)
  // ant 4767.js: resume()+pause() pump-primes the stream into readable
  // mode without entering flowing mode.
  process.stdin.resume()
  process.stdin.pause()
  // Drain any data already buffered (e.g. OSC handshake responses).
  onReadable()

  // Frame-boundary buffer: hold all incoming PTY bytes until we see
  // the inner REPL emit a frame boundary marker — either:
  //   `\x1b[2J`        clear-entire-screen (legacy full-repaint marker)
  //   `\x1b[H\x1b[2K`  cursor-home + erase-line (ant's `P` sentinel — see
  //                    5288.js daemon attach: `let P = _f + zzH`).
  // Both indicate the start of a complete frame. Until one arrives the
  // alt-screen retains the outer FleetView pixels (preserved by
  // `handoffAltScreen` — see agentsFleet.ts). When one arrives we flush
  // FROM it onwards AND wrap the flush in `BSU…ESU` to force the
  // terminal (when DEC 2026 is supported, e.g. iTerm2) to apply the
  // whole transition atomically — even if the inner's own framing
  // didn't wrap THIS chunk in BSU/ESU. Without DEC 2026 it's a no-op.
  //
  // Source: ant 5288.js attach handler —
  //   if (qH.includes(qG) || qH.includes(P)) { write(qH or r) }
  // where qG=\x1b[2J, P=\x1b[H\x1b[2K, plus the BSU/ESU wrap that ant
  // Ink already inlines around every render (terminal.ts ant equivalent).
  const FRAME_CLEAR = Buffer.from('\x1b[2J')
  const FRAME_HOME_ERASE = Buffer.from('\x1b[H\x1b[2K')
  const BSU = Buffer.from('\x1b[?2026h')
  const ESU = Buffer.from('\x1b[?2026l')
  // Source: ant 4767.js `Md` write logic — line:
  //   K.write(_.alreadyInAlt ? ru + Fl() + YH : PzH() + YH + (m ? ru : "") + ...)
  // When `alreadyInAlt` is true, ant DOES NOT buffer waiting for a
  // frame-boundary marker. It writes the ack DEC modes immediately and
  // then paints incoming PTY bytes the moment they arrive. The trick:
  //
  //   - The alt-screen buffer already has the outer FleetView pixels
  //     (preserved by `handoffAltScreen()` — no \x1b[?1049l was emitted).
  //   - The inner REPL's first paint is INVISIBLE escape codes (DEC
  //     mode sets/resets) until it finally emits its own \x1b[2J or
  //     home-erase as part of its first render. Those invisible codes
  //     change terminal state, not the visible cells.
  //   - When the inner's first render does fire, its CLEAR+CELLS pair
  //     overwrites the FleetView pixels in a single coherent paint.
  //
  // ccb previously buffered everything until a frame-boundary marker
  // appeared, which meant during the inner REPL's boot delay (~1-2s of
  // bun + bundle load + first-render) NOTHING was painted. With proper
  // handoff the alt-screen WOULD still show FleetView pixels — but only
  // if no other write happened. Inner-REPL boot emits non-clearing
  // escape codes that are safely ignored by the terminal; buffering
  // them deferred the natural transition without benefit.
  //
  // Set `attachBuffer = null` initially when CCB_ATTACH_OWNED_ALT_SCREEN
  // is set so we mirror ant exactly (no buffer). Standalone `ccb attach`
  // (no env var) keeps the buffer because runAttach itself wrote
  // `\x1b[?1049h\x1b[2J\x1b[H` and the screen is blank — buffering until
  // first frame avoids painting partial mode-setup garbage.
  const ownedAltScreen = !!process.env.CCB_ATTACH_OWNED_ALT_SCREEN
  let attachBuffer: Buffer | null = ownedAltScreen ? null : Buffer.alloc(0)

  // Render incoming PTY output to local stdout. Track DEC private modes
  // (ant 4638.js Yg) so detach can restore local terminal state. Also
  // scan for ant's APC detach sentinel (ant 4177.js $1H → 4176.js w_H).
  //
  // Source: ant 4767.js `o(s)` — buffers a partial-match tail across
  // chunk boundaries so the sentinel isn't missed across packets.
  let pendingTail: Buffer = Buffer.alloc(0)
  const handleLivePaint = (incoming: Buffer): void => {
    if (firstFrameAt === 0) {
      firstFrameAt = Date.now()
      logEvent('tengu_bg_attach_first_frame', {
        ms: String(firstFrameAt - startedAt),
      })
    }
    const wH =
      pendingTail.length > 0 ? Buffer.concat([pendingTail, incoming]) : incoming

    const idx = wH.indexOf(DETACH_APC_SENTINEL)
    if (idx >= 0) {
      if (idx > 0) {
        const before = wH.subarray(0, idx)
        decModes.feed(before)
        process.stdout.write(before)
      }
      pendingTail = Buffer.alloc(0)
      detached = true
      process.stdin.removeListener('readable', onReadable)
      return
    }

    const k = suffixMatchLen(wH, DETACH_APC_SENTINEL)
    if (wH.length > k) {
      const paint = wH.subarray(0, wH.length - k)
      decModes.feed(paint)
      process.stdout.write(paint)
    }
    pendingTail = k > 0 ? Buffer.from(wH.subarray(wH.length - k)) : Buffer.alloc(0)
  }

  const dataSub = adopter.onData(chunk => {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'binary')

    if (attachBuffer !== null) {
      attachBuffer = Buffer.concat([attachBuffer, incoming])
      const clearIdx = attachBuffer.indexOf(FRAME_CLEAR)
      const homeEraseIdx = attachBuffer.indexOf(FRAME_HOME_ERASE)
      let markerIdx = -1
      if (clearIdx >= 0 && homeEraseIdx >= 0) {
        markerIdx = Math.min(clearIdx, homeEraseIdx)
      } else if (clearIdx >= 0) {
        markerIdx = clearIdx
      } else if (homeEraseIdx >= 0) {
        markerIdx = homeEraseIdx
      }
      if (markerIdx === -1) {
        // No frame boundary yet — keep buffering. Cap at 1 MiB so a
        // misbehaving stream doesn't OOM us.
        if (attachBuffer.length > 1024 * 1024) {
          attachBuffer = attachBuffer.subarray(attachBuffer.length - 1024 * 1024)
        }
        return
      }
      // Found a boundary — flush from it. Wrap in BSU/ESU so terminals
      // supporting DEC 2026 apply the whole `clear+cells` transition
      // atomically (FleetView pixels → session UI with zero
      // intermediate paint). On terminals without sync support the
      // wrap is harmless (BSU/ESU are just unknown DECSET codes).
      const flushBytes = attachBuffer.subarray(markerIdx)
      attachBuffer = null
      handleLivePaint(Buffer.concat([BSU, flushBytes, ESU]))
      return
    }

    handleLivePaint(incoming)
  })

  // Resolve when the host signals exit OR we detach.
  const exitPromise = new Promise<void>(resolve => {
    const exitSub = adopter!.onExit(info => {
      exitCode = info.exitCode === -1 ? 1 : info.exitCode
      exitSub.dispose()
      resolve()
    })
  })

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

  // ant 5164.js stall watchdog: if no first frame within
  // ATTACH_STALL_THRESHOLD_MS, fire stall_ms (warning) + try
  // daemon-side respawn (auto-recover once). After ATTACH_STALL_GAVE_UP_MS
  // OR if respawn returned EGAVEUP, fire stall_gave_up + exit.
  let stallWarned = false
  let respawnAttempted = false
  let stallGaveUp = false
  const stallTimer = setInterval(() => {
    if (firstFrameAt > 0 || detached) return
    const elapsed = Date.now() - startedAt
    if (!stallWarned && elapsed >= ATTACH_STALL_THRESHOLD_MS) {
      stallWarned = true
      logEvent('tengu_bg_attach_stall_ms', { short, elapsed_ms: String(elapsed) })
      process.stderr.write(`\n[attach: no output from ${short} in ${Math.round(elapsed/1000)}s — worker may be stalled, attempting respawn…]\n`)
      // Try daemon-side respawn. ant 5164.js wF3.
      if (!respawnAttempted) {
        respawnAttempted = true
        void (async () => {
          try {
            const { isDaemonAlive, daemonRespawnStalled } = await import('./daemonAdapter.js')
            if (await isDaemonAlive()) {
              const r = await daemonRespawnStalled(short)
              if (!r.ok && r.code === 'EGAVEUP') {
                // Daemon refuses 2nd respawn — fall through to give-up.
                stallGaveUp = true
                clearInterval(stallTimer)
                process.stderr.write(`\n[attach: ${short} stalled after respawn — giving up]\n`)
                detached = true
                process.stdin.removeListener('readable', onReadable)
              }
            }
          } catch {
            // Best-effort; if daemon unreachable, the second pass of this
            // setInterval will hit the give-up path below.
          }
        })()
      }
    }
    if (elapsed >= ATTACH_STALL_GAVE_UP_MS) {
      stallGaveUp = true
      logEvent('tengu_bg_attach_stall_gave_up', { short, elapsed_ms: String(elapsed) })
      clearInterval(stallTimer)
      process.stderr.write(`\n[attach: gave up waiting for ${short} after ${Math.round(elapsed/1000)}s. Try 'ccb respawn ${short}']\n`)
      detached = true
      process.stdin.removeListener('readable', onReadable)
    }
  }, 1000)
  stallTimer.unref()

  // Wait for either exit or detach.
  const detachPromise = new Promise<void>(resolve => {
    const checker = setInterval(() => {
      if (detached) {
        clearInterval(checker)
        clearInterval(stallTimer)
        resolve()
      }
    }, 25)
    checker.unref()
  })

  await Promise.race([exitPromise, detachPromise])

  // ant 4638.js: emit DEC mode restore so the local terminal isn't
  // stuck in mouse-mode / bracketed-paste / etc. carried over from the
  // inner REPL.
  const restore = decModes.restoreSequence()
  if (restore) process.stdout.write(restore)

  // Alt-screen EXIT — only when we own the swap (standalone CLI).
  // FleetView caller exits alt itself after this returns.
  if (!process.env.CCB_ATTACH_OWNED_ALT_SCREEN) {
    process.stdout.write(ALT_SCREEN_EXIT)
  }

  // Cleanup.
  dataSub.dispose()
  process.stdout.removeListener('resize', onResize)
  process.stdin.removeListener('readable', onReadable)
  // NOTE: do NOT pause stdin — the caller (fleetAttach loop) is about
  // to mount a fresh Ink root which needs an active readable stream.
  // The standalone `ccb attach` CLI exits process after this anyway,
  // so leaving stdin live is harmless there too.
  adopter.dispose()
  restoreTty?.()

  const outcome = stallGaveUp ? 'stall_gave_up' : detached ? 'detached' : 'exited'
  logEvent('tengu_bg_attach_outcome', {
    outcome,
    got_first_frame: String(firstFrameAt > 0),
    ms: String(Date.now() - startedAt),
  })

  // NOTE: callers from FleetView (fleetAttach) expect runAttach to
  // RETURN — process.exit would kill the outer FleetView too. The
  // standalone `ccb attach <short>` CLI path catches this in
  // attachHandler and exits cleanly. Detach/exit reasons are surfaced
  // via the returned outcome string so callers can decide.
  if (stallGaveUp) {
    process.stderr.write(
      `\n[attach: gave up waiting for ${short}; session may be stalled]\n`,
    )
    return
  }
  if (detached) {
    process.stderr.write(`\n[detached from ${short} — session keeps running]\n`)
    return
  }
  process.stderr.write(`\n[session ${short} exited with code ${exitCode}]\n`)
}
