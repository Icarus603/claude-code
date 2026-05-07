/**
 * `ccb --bg-pty-host <sock> <cols> <rows> -- <cmd> [args...]`
 *
 * 1:1 port of ant 4702.js DW3 (PTY host runtime). Spawned by ccb's
 * BG layer (or by an external daemon supervisor) when the user
 * requests an interactive backgrounded REPL. This process:
 *
 *   1. Opens a PTY pair via `new Bun.Terminal({cols, rows, data})`.
 *   2. Spawns the requested child (typically a fresh `ccb` REPL)
 *      inside that PTY via `Bun.spawn(..., {terminal})`.
 *   3. Binds a Unix domain socket at `<sock>` and accepts attach
 *      clients. Each client gets a hello frame, a replay of the
 *      ring buffer, then a `live` frame, then live PTY output via
 *      length-prefixed data frames. Inbound data frames flow back
 *      into the PTY.
 *   4. On child exit, broadcasts an `exit` frame and tears down.
 *
 * Backpressure: per-client `writableLength > 1 MiB` ⇒ destroy that
 * client (mirrors ant's JW3=1048576). Ring buffer caps replay at 256
 * KiB. Frame cap is 1 MiB.
 *
 * @dynamicRequire
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import {
  type Server,
  type Socket,
  createServer,
} from 'node:net'
import { setPriority, getPriority } from 'node:os'
import { dirname } from 'node:path'

import {
  createFrameDecoder,
  CTRL_TAG,
  DATA_TAG,
  encodeCtrlFrame,
  encodeDataFrame,
  RING_BUFFER_BYTES,
} from './ptyFrame.js'
import { createRing } from './ptyRing.js'

/** Per-client writable backpressure cap; matches ant JW3. */
const CLIENT_BACKPRESSURE_BYTES = 1024 * 1024
/** SIGTERM → SIGKILL escalation delay; matches ant 4702.js:91. */
const SIGTERM_GRACE_MS = 5000

/** Compute the breadcrumb path for socket `sock`. ant 4137.js:114-116. */
function breadcrumbPath(sock: string): string {
  if (process.platform === 'win32') {
    // Windows uses a separate dir; we mirror Unix-only behavior here
    // (ccb has no daemon yet, the Win path is only relevant to it).
    return `${sock}.err`
  }
  return `${sock}.err`
}

/** Best-effort breadcrumb write + exit(1). Mirrors ant $P_. */
function writeBreadcrumbAndExit(sock: string | undefined, msg: string): never {
  if (sock) {
    try {
      const p = breadcrumbPath(sock)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, `${new Date().toISOString()} ${msg}\n`)
    } catch {
      // best-effort
    }
  }
  process.exit(1)
}

/**
 * Entry point. Receives argv tail starting with the socket path.
 * Caller (cli.tsx fast-path) strips the `--bg-pty-host` flag itself.
 *
 *   args = [sock, cols, rows, '--', cmd, ...cmdArgs]
 *
 * @dynamicRequire
 */
export async function runPtyHost(args: readonly string[]): Promise<void> {
  const dashDash = args.indexOf('--')
  if (dashDash < 3 || dashDash === args.length - 1) {
    writeBreadcrumbAndExit(
      undefined,
      'bad argv: --bg-pty-host <sock> <cols> <rows> -- <cmd> [args...]',
    )
  }
  const sock = args[0]!
  process.on('uncaughtException', err =>
    writeBreadcrumbAndExit(
      sock,
      `uncaught: ${err instanceof Error ? err.stack ?? String(err) : String(err)}`,
    ),
  )
  process.on('unhandledRejection', err =>
    writeBreadcrumbAndExit(
      sock,
      `unhandledRejection: ${err instanceof Error ? err.stack ?? String(err) : String(err)}`,
    ),
  )

  const cols = Number(args[1]) || 200
  const rows = Number(args[2]) || 50
  const cmd = args[dashDash + 1]!
  const cmdArgs = args.slice(dashDash + 2)

  // Niceness +5 to keep the host out of the way of the parent shell;
  // ant 4702.js:28-31. Skip on Windows (no setpriority).
  if (process.platform !== 'win32') {
    try {
      setPriority(0, Math.min(getPriority(0) + 5, 19))
    } catch {
      // best-effort
    }
  }

  const ring = createRing(RING_BUFFER_BYTES)
  const clients = new Set<Socket>()
  let exited = false
  let exitCode = 0
  let exitSignal: string | undefined

  /** Fan-out a buffer to all connected clients with backpressure check. */
  function broadcast(buf: Buffer): void {
    for (const c of clients) {
      if (c.destroyed) {
        clients.delete(c)
        continue
      }
      if (c.writableLength > CLIENT_BACKPRESSURE_BYTES) {
        c.destroy()
        clients.delete(c)
        continue
      }
      c.write(buf)
    }
  }

  /** Safe write helper — skip destroyed sockets. */
  function safeWrite(c: Socket, buf: Buffer): void {
    if (!c.destroyed) c.write(buf)
  }

  /** Handle a control frame from an attach client. */
  function handleCtrl(
    terminal: Bun.Terminal,
    child: { kill: (sig: NodeJS.Signals) => void },
    frame: { t: string } & Record<string, unknown>,
  ): void {
    switch (frame.t) {
      case 'resize': {
        const c = Number(frame['cols'])
        const r = Number(frame['rows'])
        if (c > 0 && c <= 10000 && r > 0 && r <= 10000 && !exited) {
          terminal.resize(c, r)
          if (process.platform !== 'win32') {
            try {
              process.kill(-process.pid, 'SIGWINCH')
            } catch {
              // best-effort
            }
          }
        }
        return
      }
      case 'kill': {
        const sig: NodeJS.Signals =
          frame['sig'] === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM'
        try {
          child.kill(sig)
        } catch {
          // best-effort
        }
        if (sig === 'SIGTERM') {
          setTimeout(() => {
            if (!exited) {
              try {
                child.kill('SIGKILL')
              } catch {
                // best-effort
              }
            }
          }, SIGTERM_GRACE_MS).unref()
        }
        return
      }
      default:
        return
    }
  }

  // Open PTY + spawn child. ant 4702.js:51-65.
  let terminal: Bun.Terminal
  let child: ReturnType<typeof Bun.spawn>
  try {
    terminal = new Bun.Terminal({
      cols,
      rows,
      data(_term: unknown, data: Buffer | Uint8Array): void {
        const buf = Buffer.from(data)
        ring.push(buf)
        if (clients.size > 0) broadcast(encodeDataFrame(buf))
      },
    })
    child = Bun.spawn([cmd, ...cmdArgs], {
      cwd: process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color' },
      terminal,
      windowsHide: true,
      detached: false,
    })
  } catch (err) {
    writeBreadcrumbAndExit(sock, `spawn failed: ${String(err)}`)
  }

  // Pre-clean any stale socket file at this path. ant 4702.js:103.
  if (existsSync(sock)) {
    await unlink(sock).catch(() => {})
  }

  const server: Server = createServer(socket => {
    socket.on('error', () => socket.destroy())
    socket.once('close', () => clients.delete(socket))
    // Hello frame. ant 4702.js:107-123.
    safeWrite(
      socket,
      encodeCtrlFrame({
        t: 'hello',
        replPid: child.pid ?? -1,
        version: process.env.CLAUDE_CODE_VERSION ?? 'dev',
      }),
    )
    // Ring buffer replay.
    for (const chunk of ring.chunks) safeWrite(socket, encodeDataFrame(chunk))
    safeWrite(socket, encodeCtrlFrame({ t: 'live' }))
    if (exited) {
      safeWrite(
        socket,
        encodeCtrlFrame({ t: 'exit', code: exitCode, signal: exitSignal }),
      )
      socket.end()
      return
    }
    clients.add(socket)
    const decoder = createFrameDecoder(
      f => {
        if (f.kind === DATA_TAG) {
          if (!exited) terminal.write(f.payload)
        } else if (f.kind === CTRL_TAG) {
          handleCtrl(terminal, child, f.ctrl)
        }
      },
      () => socket.destroy(),
    )
    socket.on('data', decoder)
  })
  server.on('error', err => {
    try {
      child.kill('SIGTERM')
    } catch {
      // best-effort
    }
    writeBreadcrumbAndExit(sock, `server error: ${String(err)}`)
  })
  server.listen(sock)
  server.unref()

  // Forward signals from the wrapping shell to the child.
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(sig, () => {
      try {
        child.kill(sig === 'SIGHUP' ? 'SIGTERM' : sig)
      } catch {
        // best-effort
      }
    })
  }

  // Wait for child exit; broadcast exit frame; tear down.
  exitCode = await child.exited
  exitSignal = child.signalCode ?? undefined
  exited = true
  terminal.close()
  broadcast(
    encodeCtrlFrame({ t: 'exit', code: exitCode, signal: exitSignal }),
  )
  for (const c of clients) c.end()
  // Server.close has a 2s timeout (ant 4702.js:159-161).
  await Promise.race([
    new Promise<void>(resolve => server.close(() => resolve())),
    new Promise<void>(resolve => setTimeout(() => resolve(), 2000).unref()),
  ])
  if (process.platform !== 'win32') {
    await unlink(sock).catch(() => {})
  }
  process.exit(exitCode)
}
