/**
 * Daemon RPC client — used by ccb CLI to talk to the daemon over its
 * control socket.
 *
 * Three primitives, each ported from ant 4138.js:
 *
 *   request(op, payload, opts)   → ant gY  (single-shot RPC)
 *   subscribe(op, payload, on..) → ant Ds7 (long-lived stream)
 *   leaseKeepalive(label)        → ant Js7 (heartbeat to declare
 *                                          our process to the daemon)
 *
 * @dynamicRequire
 */

import { type Socket, connect } from 'node:net'

import {
  type ErrorResponse,
  type ProtoOp,
  type Response,
  PROTO_VERSION,
  createLineDecoder,
  encodeFrame,
} from './socketProto.js'

export type { Response, ProtoOp } from './socketProto.js'
import { getControlSocketPath } from './socketPaths.js'

const DEFAULT_TIMEOUT_MS = 5000

/**
 * Send a single request to the daemon and await its reply. Times out
 * after `timeoutMs` (default 5s). Returns a typed response — caller
 * narrows on `ok`. Connection errors / timeouts surface as ErrorResponse
 * objects with `code: 'ENOCONN' | 'ETIMEOUT'` so callers can branch
 * on them without a try/catch.
 */
export async function daemonRequest(
  op: ProtoOp,
  payload: Record<string, unknown> = {},
  opts: { timeoutMs?: number; socketPath?: string } = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const socketPath = opts.socketPath ?? getControlSocketPath()

  return new Promise<Response>(resolve => {
    let resolved = false
    const finish = (resp: Response): void => {
      if (resolved) return
      resolved = true
      socket.destroy()
      resolve(resp)
    }
    const socket = connect(socketPath)
    socket.setTimeout(timeoutMs, () => {
      finish({
        ok: false,
        code: 'ETIMEOUT',
        error: 'control socket timeout',
      })
    })
    socket.on('error', err => {
      finish({
        ok: false,
        code: 'ENOCONN',
        error: (err as Error).message,
      })
    })
    socket.once('connect', () => {
      socket.write(encodeFrame({ proto: PROTO_VERSION, op, ...payload }))
    })
    const decode = createLineDecoder(
      msg => finish(msg as Response),
      err => finish({ ok: false, code: 'ENOCONN', error: err }),
    )
    socket.on('data', decode)
    socket.once('close', () => {
      if (!resolved) {
        finish({
          ok: false,
          code: 'ENOCONN',
          error:
            'connection dropped mid-request — daemon may have restarted; retry',
        })
      }
    })
  })
}

/**
 * Subscribe to a long-lived daemon stream (e.g. log subscribe).
 * Calls `onMessage` for each frame received, `onError` on failure.
 * Returns a `dispose()` to close the stream.
 *
 * Mirrors ant Ds7 (4138.js:126-152).
 */
export function daemonSubscribe(
  op: ProtoOp,
  payload: Record<string, unknown>,
  onMessage: (msg: Response) => void,
  onError: (err: string) => void,
  opts: { socketPath?: string } = {},
): () => void {
  const socketPath = opts.socketPath ?? getControlSocketPath()
  const socket = connect(socketPath)
  let closed = false
  const finish = (err: string): void => {
    if (closed) return
    closed = true
    socket.destroy()
    onError(err)
  }
  socket.on('error', err => finish((err as Error).message))
  socket.on('close', () => finish('control socket closed'))
  socket.once('connect', () => {
    socket.write(encodeFrame({ proto: PROTO_VERSION, op, ...payload }))
  })
  const decode = createLineDecoder(
    msg => {
      const r = msg as Response
      if (r.ok === false) finish((r as ErrorResponse).error)
      else onMessage(r)
    },
    err => finish(err),
  )
  socket.on('data', decode)
  return () => {
    closed = true
    socket.destroy()
  }
}

/**
 * Background lease keepalive. Connects, sends `{op: 'lease', client}`,
 * holds the connection. On close, retries every 1s. Returns a stop fn.
 *
 * Used so the daemon can track which CLI processes are interested
 * (for graceful shutdown ordering).
 *
 * Mirrors ant Js7 (4138.js:95-125).
 */
export function leaseKeepalive(label: string): () => void {
  const client = { label, cwd: process.cwd(), pid: process.pid }
  let stopped = false
  let socket: Socket | null = null
  let retryTimer: NodeJS.Timeout | null = null

  const open = (): void => {
    if (stopped) return
    socket = connect(getControlSocketPath())
    socket.on('error', () => socket?.destroy())
    socket.once('connect', () => {
      socket?.write(encodeFrame({ proto: PROTO_VERSION, op: 'lease', client }))
    })
    socket.on('data', () => {
      // Daemon may send keep-alive ACKs; we ignore them.
    })
    socket.once('close', () => {
      socket = null
      if (stopped) return
      retryTimer = setTimeout(open, 1000)
      retryTimer.unref()
    })
    socket.unref()
  }

  open()
  return () => {
    stopped = true
    if (retryTimer) clearTimeout(retryTimer)
    socket?.destroy()
  }
}
