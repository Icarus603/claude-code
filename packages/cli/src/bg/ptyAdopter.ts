/**
 * PTY socket adopter — speaks the bg-pty-host wire protocol.
 *
 * Daemon-less ccb's `ccb attach <short>` opens this directly against
 * the PTY host's socket; a future Phase C+ daemon would also use it
 * for cross-process supervision. Mirrors ant 4704.js rj6, but trimmed
 * down: ccb has no daemon supervisor so the respawn-detection /
 * upgrade-tracking / roster-hooks branches are removed. What's kept:
 *
 *   - Connect with backoff (WXK=30 attempts, PXK=[100,250,500,1000,2000])
 *   - ENOENT detection (socket file gone) → caller-visible error
 *   - Hello-handshake receipt (capture replPid + version)
 *   - Buffer queue while disconnected (cap 2MB before drop)
 *   - Per-client backpressure: writableLength > 1 MiB → destroy
 *   - onData / onExit pub-sub callbacks
 *   - write / resize / kill / dispose API surface
 *   - SIGKILL escalation 5s after SIGTERM
 *
 * @dynamicRequire
 */

import { type Socket, connect } from 'node:net'

import {
  CTRL_TAG,
  DATA_TAG,
  type CtrlFrame,
  createFrameDecoder,
  encodeCtrlFrame,
  encodeDataFrame,
  FRAME_SIZE_CAP,
} from './ptyFrame.js'

const RECONNECT_BACKOFF_MS = [100, 250, 500, 1000, 2000] as const
const MAX_RECONNECT_ATTEMPTS = 30
const QUEUE_CAP_BYTES = 2 * FRAME_SIZE_CAP // 2 * qiH = 2 MiB
const CLIENT_BACKPRESSURE_BYTES = 1024 * 1024
const SIGTERM_GRACE_MS = 5000

export interface PtyAdopter {
  /** Currently-known REPL pid (from hello frame). 0 if not yet seen. */
  replPid(): number
  /** Currently-known REPL version (from hello frame). '' if not yet seen. */
  replVersion(): string
  /** Send raw bytes to the PTY (will be decoded as user input). Takes a
   *  Buffer, NOT a string: stdin bytes (esp. multi-byte UTF-8 like CJK) must
   *  pass through verbatim. A string round-trip (toString('binary') at the
   *  caller + Buffer.from(s,'utf8') here) double-encoded high bytes and
   *  corrupted CJK input. */
  write(b: Buffer): void
  /** Send a resize ctrl frame. */
  resize(cols: number, rows: number): void
  /** Send a kill ctrl frame. SIGTERM auto-escalates to SIGKILL after 5s. */
  kill(sig: 'SIGTERM' | 'SIGKILL'): void
  /** Tear down the adopter (closes socket, cancels timers). */
  dispose(): void
  /** Subscribe to PTY output (bytes from the host). */
  onData(cb: (chunk: Buffer) => void): { dispose: () => void }
  /** Subscribe to host exit notification. */
  onExit(
    cb: (info: { exitCode: number; signal?: string }) => void,
  ): { dispose: () => void }
  /** Subscribe to host heartbeat ctrl-frames (every 5s while alive). */
  onHeartbeat(cb: (info: { ts: number; state?: string }) => void): { dispose: () => void }
}

interface AdopterEvent<T> {
  emit(value: T): void
  subscribe(cb: (value: T) => void): () => void
}

function makeEvent<T>(): AdopterEvent<T> {
  const subs = new Set<(value: T) => void>()
  return {
    emit(value: T): void {
      for (const cb of subs) cb(value)
    },
    subscribe(cb: (value: T) => void): () => void {
      subs.add(cb)
      return () => subs.delete(cb)
    },
  }
}

/**
 * Open an adopter against the PTY socket at `socketPath`. Returns
 * immediately; the connection happens asynchronously and any data
 * sent via `write/resize/kill` before connect completes is queued.
 */
export function createPtyAdopter(socketPath: string): PtyAdopter {
  const onDataEvent = makeEvent<Buffer>()
  const onExitEvent = makeEvent<{ exitCode: number; signal?: string }>()
  const onHeartbeatEvent = makeEvent<{ ts: number; state?: string }>()

  let socket: Socket | undefined
  let pendingFrames: Buffer[] = []
  let pendingBytes = 0
  let connected = false
  let disposed = false
  let attempt = 0
  let reconnectTimer: NodeJS.Timeout | undefined
  let drainTimer: NodeJS.Timeout | undefined
  let backpressureTimer: NodeJS.Timeout | undefined
  let sigkillTimer: NodeJS.Timeout | undefined
  let helloPid = 0
  let helloVersion = ''

  function clearTimers(): void {
    if (drainTimer) {
      clearTimeout(drainTimer)
      drainTimer = undefined
    }
    if (backpressureTimer) {
      clearTimeout(backpressureTimer)
      backpressureTimer = undefined
    }
  }

  function notifyExit(exitCode: number, signal?: string): void {
    if (disposed) return
    disposed = true
    if (sigkillTimer) {
      clearTimeout(sigkillTimer)
      sigkillTimer = undefined
    }
    clearTimers()
    socket?.destroy()
    socket = undefined
    onExitEvent.emit({ exitCode, signal })
  }

  function enqueueOrSend(frame: Buffer): void {
    if (socket && !socket.destroyed) {
      const ok = socket.write(frame)
      if (!ok) {
        // backpressure — schedule destroy if drain doesn't fire in 10s
        // (ant XW3 = 10000), and immediate destroy if the buffer crosses
        // CLIENT_BACKPRESSURE_BYTES (ant GXK).
        if (!drainTimer) {
          drainTimer = setTimeout(() => {
            drainTimer = undefined
            socket?.destroy()
          }, 10_000)
          drainTimer.unref()
        }
        if (
          !backpressureTimer &&
          socket.writableLength > CLIENT_BACKPRESSURE_BYTES
        ) {
          backpressureTimer = setTimeout(() => {
            backpressureTimer = undefined
            if (
              socket &&
              !socket.destroyed &&
              socket.writableLength > CLIENT_BACKPRESSURE_BYTES
            ) {
              clearTimers()
              socket.destroy()
            }
          }, 50) // ant PW3 = 50ms grace
          backpressureTimer.unref()
        }
      }
      return
    }
    // Not connected — queue. Drop oldest if over cap.
    if (pendingBytes + frame.length > QUEUE_CAP_BYTES) return
    pendingFrames.push(frame)
    pendingBytes += frame.length
  }

  function handleFrame(frame: { kind: number; payload?: Buffer; ctrl?: CtrlFrame }): void {
    if (frame.kind === DATA_TAG && frame.payload) {
      onDataEvent.emit(frame.payload)
    } else if (frame.kind === CTRL_TAG && frame.ctrl) {
      const c = frame.ctrl
      if (c.t === 'hello') {
        helloPid = c.replPid
        helloVersion = c.version
      } else if (c.t === 'live') {
        // No-op; live just signals that ring buffer replay is done.
      } else if (c.t === 'exit') {
        notifyExit(c.code, c.signal)
      } else if (c.t === 'heartbeat') {
        onHeartbeatEvent.emit({ ts: c.ts, state: c.state })
      }
    }
  }

  function tryConnect(): void {
    if (disposed || connected) return
    const sock = connect(socketPath)
    let opened = false
    sock.on('error', err => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Socket file is gone — host died or never started.
        // Bubble up as exit so the caller can give up. ant 4704.js:95
        // would retry here; daemon-less ccb has no host to wait for.
        if (!opened) notifyExit(-1, 'ENOENT')
      }
      sock.destroy()
    })
    sock.once('close', () => {
      if (socket === sock) {
        socket = undefined
        connected = false
        clearTimers()
      }
      if (!disposed && !opened) {
        // Connection failed before opening — schedule retry.
        scheduleReconnect()
      }
    })
    sock.once('connect', () => {
      opened = true
      connected = true
      attempt = 0
      socket = sock
      sock.on('drain', clearTimers)
      // Flush queued frames.
      const queued = pendingFrames
      pendingFrames = []
      pendingBytes = 0
      for (const f of queued) enqueueOrSend(f)
    })
    const decoder = createFrameDecoder(handleFrame, () => sock.destroy())
    sock.on('data', decoder)
  }

  function scheduleReconnect(): void {
    if (disposed || reconnectTimer) return
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      notifyExit(-1, 'reconnect-exhausted')
      return
    }
    const delay =
      RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)]!
    attempt++
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      tryConnect()
    }, delay)
    reconnectTimer.unref()
  }

  // Kick off the initial connection.
  tryConnect()

  return {
    replPid: () => helloPid,
    replVersion: () => helloVersion,
    write(buf: Buffer): void {
      if (disposed) return
      // Frame body cap is 1 MiB; chunk if larger.
      const chunkSize = FRAME_SIZE_CAP - 1
      for (let i = 0; i < buf.length; i += chunkSize) {
        enqueueOrSend(encodeDataFrame(buf.subarray(i, i + chunkSize)))
      }
    },
    resize(cols: number, rows: number): void {
      if (disposed) return
      enqueueOrSend(encodeCtrlFrame({ t: 'resize', cols, rows }))
    },
    kill(sig: 'SIGTERM' | 'SIGKILL'): void {
      if (disposed) return
      enqueueOrSend(encodeCtrlFrame({ t: 'kill', sig }))
      if (sig === 'SIGTERM') {
        if (sigkillTimer) clearTimeout(sigkillTimer)
        sigkillTimer = setTimeout(() => {
          sigkillTimer = undefined
          if (!disposed) {
            enqueueOrSend(encodeCtrlFrame({ t: 'kill', sig: 'SIGKILL' }))
          }
        }, SIGTERM_GRACE_MS)
        sigkillTimer.unref()
      }
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
      if (sigkillTimer) {
        clearTimeout(sigkillTimer)
        sigkillTimer = undefined
      }
      clearTimers()
      socket?.destroy()
      socket = undefined
    },
    onData(cb): { dispose: () => void } {
      const off = onDataEvent.subscribe(cb)
      return { dispose: off }
    },
    onExit(cb): { dispose: () => void } {
      const off = onExitEvent.subscribe(cb)
      return { dispose: off }
    },
    onHeartbeat(cb): { dispose: () => void } {
      const off = onHeartbeatEvent.subscribe(cb)
      return { dispose: off }
    },
  }
}
