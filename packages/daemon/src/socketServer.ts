/**
 * Daemon control socket server. Listens at the control socket path,
 * accepts CLI client connections, dispatches op codes to a registry
 * of handlers.
 *
 * Each connection is one-shot for most ops (request → response → close);
 * `subscribe`, `attach`, and `lease` are long-lived.
 *
 * @dynamicRequire
 */

import { existsSync, mkdirSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import {
  type Server,
  type Socket,
  createServer,
} from 'node:net'
import { dirname } from 'node:path'

import { logEvent } from '@claude-code/local-observability'
import { checkPeerUid } from './peerUid.js'
import {
  type ErrorResponse,
  type OkResponse,
  type ProtoOp,
  type Response,
  PROTO_VERSION,
  createLineDecoder,
  encodeFrame,
} from './socketProto.js'
import { getControlSocketPath } from './socketPaths.js'

/**
 * A handler may either return a Response (one-shot) or spawn a
 * long-lived stream by writing directly to the socket and never
 * returning.
 */
export type OpHandler = (
  msg: Record<string, unknown>,
  socket: Socket,
) => Promise<Response | undefined>

export interface DaemonServer {
  /** Number of currently-connected clients (incl. lease holders). */
  readonly clientCount: number
  /** Stop accepting new connections + close all current clients. */
  close(): Promise<void>
}

/**
 * Bind the control socket at the standard path and start serving.
 * Pre-cleans any stale socket file. Returns a DaemonServer handle
 * with a clientCount probe + close method.
 */
export async function startSocketServer(
  handlers: Partial<Record<ProtoOp, OpHandler>>,
  opts: { socketPath?: string } = {},
): Promise<DaemonServer> {
  const socketPath = opts.socketPath ?? getControlSocketPath()
  // Ensure parent dir exists (mode 0o700 — owner only).
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 })
  // Pre-clean stale socket.
  if (existsSync(socketPath)) {
    await unlink(socketPath).catch(() => {})
  }

  const clients = new Set<Socket>()

  function reply(socket: Socket, resp: Response): void {
    if (socket.destroyed) return
    socket.write(encodeFrame(resp))
  }

  function dispatch(socket: Socket, msg: unknown): void {
    if (typeof msg !== 'object' || msg === null) {
      reply(socket, {
        ok: false,
        code: 'EBADREQ',
        error: 'request must be an object',
      } as ErrorResponse)
      socket.end()
      return
    }
    const m = msg as Record<string, unknown>
    // ant 4138.js proto-version handshake: clients pass `proto: PROTO_VERSION`.
    // If mismatched, emit tengu_bg_proto_mismatch + reject before op dispatch.
    const proto = m.proto as number | undefined
    if (typeof proto === 'number' && proto !== PROTO_VERSION) {
      logEvent('tengu_bg_proto_mismatch', {
        client_proto: String(proto),
        server_proto: String(PROTO_VERSION),
      })
      reply(socket, {
        ok: false,
        code: 'EUNSUPPORTED',
        error: `proto mismatch: client=${proto} server=${PROTO_VERSION}`,
      } as ErrorResponse)
      socket.end()
      return
    }
    const op = m.op as ProtoOp | undefined
    if (!op || typeof op !== 'string') {
      reply(socket, {
        ok: false,
        code: 'EBADREQ',
        error: 'missing op',
      } as ErrorResponse)
      socket.end()
      return
    }
    const handler = handlers[op]
    if (!handler) {
      reply(socket, {
        ok: false,
        code: 'EUNSUPPORTED',
        error: `unknown op: ${op}`,
      } as ErrorResponse)
      socket.end()
      return
    }
    Promise.resolve(handler(m, socket))
      .then(resp => {
        if (resp) {
          reply(socket, resp)
          // One-shot ops close after reply. Long-lived ops handle their
          // own lifecycle (return void).
          socket.end()
        }
      })
      .catch(err => {
        reply(socket, {
          ok: false,
          code: 'EBADREQ',
          error: (err as Error).message,
        } as ErrorResponse)
        socket.end()
      })
  }

  const server: Server = createServer(socket => {
    clients.add(socket)
    socket.on('error', () => socket.destroy())
    socket.once('close', () => clients.delete(socket))
    // ant 5164.js — reject connections from a different uid before
    // any data flows. SO_PEERCRED on Linux / LOCAL_PEERCRED on macOS.
    // Best-effort: null return from checkPeerUid means we can't
    // verify (Windows / FFI failure / non-fd handle) and we accept.
    const peerErr = checkPeerUid(socket)
    if (peerErr) {
      logEvent('tengu_daemon_peer_uid_reject', {})
      // ant defers the reply until the first data byte to give the
      // client decoder a chance to surface a clean error. Mirror.
      socket.once('data', () => {
        reply(socket, {
          ok: false,
          code: 'EPEERUID',
          error: peerErr,
        } as ErrorResponse)
        socket.end()
      })
      return
    }
    const decoder = createLineDecoder(
      msg => dispatch(socket, msg),
      err => {
        reply(socket, {
          ok: false,
          code: 'EBADREQ',
          error: err,
        } as ErrorResponse)
        socket.end()
      },
    )
    socket.on('data', decoder)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => resolve())
  })

  return {
    get clientCount(): number {
      return clients.size
    },
    async close(): Promise<void> {
      for (const c of clients) c.destroy()
      clients.clear()
      await new Promise<void>(resolve => server.close(() => resolve()))
      if (process.platform !== 'win32') {
        await unlink(socketPath).catch(() => {})
      }
    },
  }
}

/** Convenience builder for OK responses. */
export function ok<T extends Record<string, unknown>>(extras: T): OkResponse {
  return { ok: true, ...extras }
}

/** Convenience builder for error responses. */
export function err(
  code: ErrorResponse['code'],
  error: string,
  extras: Record<string, unknown> = {},
): ErrorResponse {
  return { ok: false, code, error, ...extras }
}
