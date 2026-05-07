/**
 * Daemon socket wire protocol.
 *
 * Envelope: each request and response is a single JSON object followed
 * by a `\n` terminator. ant 4138.js uses the same format (line 64-67:
 * `EH(H) + "\n"`).
 *
 * Protocol version: ant uses `proto: W5` where W5 is a constant that
 * gets bumped on breaking changes. ccb mirrors as `PROTO_VERSION` =
 * 1 for now; we'll bump if we change framing semantics.
 *
 * Op codes (CLI → Daemon unless noted):
 *   ping            — liveness check
 *   nudge           — poll daemon restart state (returns {restarting})
 *   list            — enumerate active workers
 *   spawn           — create new bg session (with dispatch envelope)
 *   dispatch        — alt dispatch path; takes nonce + spool file
 *   await-ack       — wait for spawn/dispatch ACK by nonce
 *   subscribe       — stream worker output (snapshot + delta)
 *   attach          — open per-job claim socket (handshake to PTY)
 *   resize          — propagate window resize from client
 *   kill            — signal worker; returns {confirmed: bool}
 *   respawn         — kill + restart same short id
 *   retire          — schedule retire after idleGracePeriodMs
 *   shutdown        — graceful daemon shutdown
 *   reply           — send text input to a blocked worker
 *   attacher-caps   — advertise client capabilities
 *   lease           — keepalive heartbeat from CLI client
 *
 * Plus daemon-side worker → daemon ops (forward-only):
 *   heartbeat, state, done, detach-request
 *
 * @dynamicRequire
 */

export const PROTO_VERSION = 1

export type ProtoOp =
  | 'ping'
  | 'nudge'
  | 'list'
  | 'spawn'
  | 'dispatch'
  | 'await-ack'
  | 'subscribe'
  | 'attach'
  | 'resize'
  | 'kill'
  | 'respawn'
  | 'retire'
  | 'shutdown'
  | 'reply'
  | 'attacher-caps'
  | 'lease'

export interface BaseRequest {
  proto: number
  op: ProtoOp
}

export interface OkResponse {
  ok: true
  op?: ProtoOp
  [k: string]: unknown
}

export interface ErrorResponse {
  ok: false
  code:
    | 'ENOCONN'
    | 'ETIMEOUT'
    | 'ENOJOB'
    | 'ESTALE'
    | 'EALIVE'
    | 'EBUSY'
    | 'EBADREQ'
    | 'EUNSUPPORTED'
    | string
  error: string
  [k: string]: unknown
}

export type Response = OkResponse | ErrorResponse

/** Encode a request/response as the wire envelope (JSON + LF). */
export function encodeFrame(obj: object): string {
  return `${JSON.stringify(obj)}\n`
}

/**
 * Stateful line decoder for socket data. Calls `onMessage` once per
 * complete `\n`-terminated JSON line; calls `onError` and stops on
 * malformed input.
 */
export function createLineDecoder(
  onMessage: (msg: unknown) => void,
  onError: (msg: string) => void,
): (chunk: string | Buffer) => void {
  let buf = ''
  let stopped = false
  return (chunk: string | Buffer) => {
    if (stopped) return
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    while (true) {
      const idx = buf.indexOf('\n')
      if (idx < 0) return
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      if (line.length === 0) continue
      try {
        onMessage(JSON.parse(line))
      } catch (err) {
        stopped = true
        onError(`bad protocol line: ${(err as Error).message}`)
        return
      }
    }
  }
}
