/**
 * Rendezvous (control) socket CLIENT — supervisor side.
 *
 * 1:1 port of ant 5016.js `naK`. The daemon's WorkerVm opens one of these
 * against each worker's rendezvous socket (`<jobDir>/rv.sock`). It is the
 * out-of-band control channel, SEPARATE from the PTY data socket:
 *
 *   - PTY socket  (ptyHost/ptyAdopter): screen bytes, attach/replay.
 *   - rv socket   (this + rvServer):    authoritative state/done/heartbeat
 *                                       pushed by the inner REPL, plus
 *                                       supervisor→worker shutdown/repaint/
 *                                       reply/attacher-caps.
 *
 * Connection model (ant naK, verbatim):
 *   - On construction, connect immediately.
 *   - On connect: reset attempt counter, send the handshake frame
 *     `{ proto, role: 'supervisor', supervisorPid }`, then read newline-
 *     delimited JSON frames and forward each typed message to `onMessage`.
 *   - On close of an ESTABLISHED connection: call `onDisconnect` (the
 *     WorkerVm uses this to immediately re-check the worker pid), then
 *     schedule a reconnect.
 *   - Reconnect backoff: `[100, 250, 500, 1000, 2000]` ms (clamped to the
 *     last entry), capped at 30 attempts. After exhaustion, log
 *     `tengu_bg_rv_connect_exhausted` and stop — the WorkerVm's pid-poll is
 *     the liveness backstop from that point on (rv is an optimisation over
 *     pid-poll, never the only signal).
 *   - `send()`: if there's no live socket and we'd exhausted, reset the
 *     counter and retry (a send is evidence the supervisor still cares
 *     about this worker). Returns false when the frame couldn't be written.
 *
 * Wire framing matches the rest of the daemon protocol (socketProto.ts):
 * one JSON object per line, `\n`-terminated. The handshake carries a
 * `role` field; the server (rvServer.ts) discards any frame that has one,
 * so the handshake is a pure marker and never reaches the worker's
 * command handler (ant kb3: `if("role"in _)return`).
 *
 * @dynamicRequire
 */

import { Socket } from 'node:net'

import { logEvent } from '@claude-code/local-observability'

import { PROTO_VERSION, createLineDecoder, encodeFrame } from './socketProto.js'

/**
 * Messages the worker's rv server pushes to the supervisor. Mirrors ant
 * 4291.js `no({type:...})` sends + the 5017.js `connectRv` onMessage
 * dispatch. The supervisor only ever ACTS on these five `type`s; unknown
 * types are ignored (forward-compatible).
 */
export type RvServerMessage =
  | { type: 'heartbeat' }
  | { type: 'done'; outcome: 'done' | 'crashed' | 'killed' }
  | { type: 'state'; patch: Record<string, unknown> }
  | { type: 'detach-request'; msg?: string }
  | { type: 'repaint-done' }
  | { type: 'shutting-down' }

/**
 * Messages the supervisor sends to the worker. Mirrors ant 5017.js
 * `this.rv.send({type:...})` calls + the 4291.js `kb3` handler.
 */
export type RvClientMessage =
  | { type: 'shutdown' }
  | { type: 'repaint' }
  | { type: 'reply'; text: string }
  | { type: 'attacher-caps'; caps: unknown }

export interface RvClient {
  /** Send a control frame to the worker. Returns false if not deliverable. */
  send(msg: RvClientMessage): boolean
  /** Tear down: stop reconnecting + destroy the socket. */
  close(): void
}

/** ant naK backoff (`daK`, assigned in 5017.js iaK init). */
const RV_BACKOFF_MS = [100, 250, 500, 1000, 2000] as const
/** ant naK max attempts (`caK = 30`). */
const RV_MAX_ATTEMPTS = 30

/**
 * Open a rendezvous client against `socketPath`.
 *
 * @param socketPath   the worker's rv.sock path
 * @param onMessage    invoked per typed frame the worker pushes
 * @param onDisconnect invoked whenever an ESTABLISHED connection drops
 *                     (ant `q`) — the WorkerVm wires this to checkPid()
 * @param onConnect    invoked on each successful (re)connect (ant `K`) —
 *                     the WorkerVm wires this to mark workerReady + flush a
 *                     deferred resize + (re)send attacher-caps
 */
export function createRvClient(
  socketPath: string,
  onMessage: (msg: RvServerMessage) => void,
  onDisconnect: () => void,
  onConnect: () => void,
): RvClient {
  let socket: Socket | undefined
  let closed = false
  let attempt = 0
  let gaveUp = false
  let reconnectTimer: NodeJS.Timeout | undefined

  /** ant `Y` — open one connection attempt. */
  function tryConnect(): void {
    if (closed) return
    const sock = new Socket()
    let opened = false
    sock.on('error', () => scheduleReconnect())
    sock.once('close', () => {
      if (socket === sock) socket = undefined
      if (closed) return
      // Only fire onDisconnect when the connection had actually opened —
      // a never-opened socket just retries (ant: `if(J)q()`).
      if (opened) onDisconnect()
      scheduleReconnect()
    })
    sock.once('connect', () => {
      opened = true
      attempt = 0
      gaveUp = false
      socket = sock
      onConnect()
      // Handshake — `role` marks this frame as supervisor-side so the
      // worker's command handler discards it (ant kb3 `if("role"in _)return`).
      try {
        sock.write(
          encodeFrame({
            proto: PROTO_VERSION,
            role: 'supervisor',
            supervisorPid: process.pid,
          }),
        )
      } catch {
        // best-effort — a write failure here triggers close/error → retry.
      }
      const decode = createLineDecoder(
        msg => {
          if (msg && typeof msg === 'object' && 'type' in msg) {
            onMessage(msg as RvServerMessage)
          }
        },
        () => sock.destroy(),
      )
      sock.on('data', decode)
    })
    sock.connect(socketPath)
  }

  /** ant `w` — schedule the next reconnect with backoff, or give up. */
  function scheduleReconnect(): void {
    if (closed || reconnectTimer || gaveUp) return
    if (attempt >= RV_MAX_ATTEMPTS) {
      gaveUp = true
      logEvent('tengu_bg_rv_connect_exhausted', { attempts: String(attempt) })
      return
    }
    const delay = RV_BACKOFF_MS[Math.min(attempt, RV_BACKOFF_MS.length - 1)]!
    attempt++
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      tryConnect()
    }, delay)
    reconnectTimer.unref()
  }

  tryConnect()

  return {
    send(msg: RvClientMessage): boolean {
      if (!socket || socket.destroyed) {
        // A send means the supervisor still cares — if we'd given up,
        // reset and kick a fresh reconnect cycle (ant naK send()).
        if (attempt >= RV_MAX_ATTEMPTS) {
          attempt = 0
          gaveUp = false
          scheduleReconnect()
        }
        return false
      }
      try {
        socket.write(encodeFrame(msg))
        return true
      } catch (e) {
        logEvent('tengu_bg_rv_send_failed', { error: String(e).slice(0, 80) })
        return false
      }
    },
    close(): void {
      closed = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
      socket?.destroy()
      socket = undefined
    },
  }
}
