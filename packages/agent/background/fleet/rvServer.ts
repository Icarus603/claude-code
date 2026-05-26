/**
 * Rendezvous (control) socket SERVER — worker side.
 *
 * 1:1 port of ant 4291.js (`w06` module: startRendezvousServer / sendRv /
 * stopRendezvousServer / the kb3 command handler / the startup-wedge
 * watchdog / markStartupDialogBlocked). Runs INSIDE the inner bg REPL
 * process. Binds the Unix socket named by `CLAUDE_BG_RENDEZVOUS_SOCK`
 * (set by spawnPty.ts) and gives the worker an out-of-band channel to
 * push authoritative lifecycle to its supervising daemon — the channel
 * ccb previously lacked, forcing the disk-poll heuristic in
 * `useBgFleetStateSync`.
 *
 * Lives in `agent/background/fleet/` (not `daemon/`) because it runs in
 * the inner REPL and is started by a REPL hook: `repl → agent` is an
 * established edge (useBgFleetStateSync), whereas `repl → daemon` would be
 * a new backwards edge (the REPL must not import the supervisor package).
 * The supervisor-side counterpart is `daemon/rvClient.ts`. The two share
 * the daemon's newline-JSON frame codec — `agent → daemon` is also already
 * established (replyToFleetJob / listFleetJobs import daemonClient).
 *
 * Why a SEPARATE socket from the PTY:
 *   The inner REPL's stdout is screen bytes flowing through the PTY. It
 *   has no clean way to interleave structured control messages there. ant
 *   solves this with a dedicated rendezvous socket the worker binds and
 *   the supervisor connects to (rvClient.ts). The worker pushes `state` /
 *   `done` / `heartbeat`; the supervisor pushes `shutdown` / `repaint` /
 *   `reply` / `attacher-caps`.
 *
 * Connection model (ant verbatim):
 *   - Single connection at a time — a new connect destroys the previous
 *     (`lo?.destroy(); lo = _`). Last-writer-wins; the supervisor is the
 *     only legitimate client.
 *   - Newline-delimited JSON frames (daemon socketProto codec).
 *   - On a fresh connection, run the startup-settle pass (ant Vb3): wait
 *     for the renderer, then arm the startup-wedge watchdog.
 *   - Emit a `heartbeat` frame every 30 s so the supervisor's liveness
 *     model (rvClient → WorkerVm heartbeat-staleness) treats the worker as
 *     alive even when the PTY ring is silent.
 *   - Inbound frames carrying a `role` field are the supervisor handshake
 *     and are discarded by the command handler (ant kb3 `if("role"in _)`).
 *
 * Host integration is via injected callbacks (ports-and-adapters) so this
 * module has no dependency on the REPL/Ink internals and stays unit-
 * testable. The REPL installs the real callbacks when it starts the
 * server (see useBgRendezvousServer).
 *
 * @dynamicRequire
 */

import { type Server, type Socket, createServer } from 'node:net'
import { unlink } from 'node:fs/promises'

import { logEvent } from '@claude-code/local-observability'
import { deleteEnv, readEnv } from '@claude-code/config/env'
import {
  createLineDecoder,
  encodeFrame,
} from '@claude-code/daemon/socketProto.js'

import type { FleetJobState } from './fleetTypes.js'
import { readJobState, writeJobState } from './fleetStore.js'

/** Frames the supervisor sends us (ant kb3 handler dispatch). */
type InboundFrame =
  | { type: 'shutdown' }
  | { type: 'repaint' }
  | { type: 'reply'; text: string }
  | { type: 'attacher-caps'; caps: unknown }
  | { role: string; [k: string]: unknown } // handshake — discarded

/** Frames we push to the supervisor (ant `no({type:...})`). */
type OutboundFrame =
  | { type: 'heartbeat' }
  | { type: 'shutting-down' }
  | { type: 'state'; patch: Partial<FleetJobState> }
  | { type: 'done'; outcome: 'done' | 'crashed' | 'killed' }
  | { type: 'repaint-done' }
  | { type: 'detach-request'; msg?: string }

/**
 * Host callbacks the REPL installs. Each mirrors a worker-internal call
 * ant 4291.js makes inline; pulling them behind an interface keeps this
 * module free of REPL/Ink imports.
 */
export interface RvServerHost {
  /**
   * ant `j5.get(process.stdout)?.forceRedraw()`. Force a full repaint of
   * the inner REPL. Return true if a redraw actually happened; false if
   * the session can't redraw right now (ant then writes the "Ctrl+Z to
   * detach" hint to stdout). Optional — when absent, repaint is a no-op
   * that still acks `repaint-done`.
   */
  forceRedraw?: () => boolean
  /**
   * ant `hw({mode, value, priority:'next'})`. Enqueue supervisor-sent text
   * as the next user prompt. Optional — absent means the worker can't
   * accept replies (no-op).
   */
  enqueueReply?: (text: string) => void
  /**
   * ant `kXK(text)` — does this text answer a currently-open question?
   * When it returns true, the reply is treated as the answer and NOT also
   * enqueued as a fresh prompt. Optional; absent ⇒ always enqueue.
   */
  answersOpenQuestion?: (text: string) => boolean
  /**
   * ant `mC6(caps)` + `Rp9(caps.colorLevel)`. Apply attacher capabilities
   * (terminal color level, etc.) advertised by the connecting client.
   */
  applyAttacherCaps?: (caps: unknown) => void
  /**
   * ant shutdown path: `eZ().teardown({skipArchive:true})` + bridge-seq
   * persist + `process.exit(0)`. Tear the session down and exit. The
   * server has already pushed `shutting-down`; the host owns the actual
   * teardown + exit. Optional — absent ⇒ the server falls back to
   * `process.exit(0)` after a short grace.
   */
  onShutdown?: () => void
  /**
   * Whether the inner renderer is up yet. ant gates the startup-settle
   * loop on `j5.has(process.stdout)`. Optional — absent ⇒ assume ready.
   */
  isRendererReady?: () => boolean
}

/** ant j06 — wedge detail. */
const WEDGE_DETAIL = 'stuck on a startup dialog'
/** ant J06 — wedge needs prompt. */
const WEDGE_NEEDS = 'open this session to continue setup'
/** ant heartbeat cadence (4291.js `setInterval(...,30000)`). */
const RV_HEARTBEAT_MS = 30_000
/** ant default startup-wedge timeout (CLAUDE_BG_STARTUP_WEDGE_MS || 45000). */
const STARTUP_WEDGE_MS_DEFAULT = 45_000

/**
 * Module-level singleton state. ant keeps these as module vars (xfH, lo,
 * xR_, KEH, uR_) because the rendezvous server is per-process — there is
 * exactly one inner REPL per worker.
 */
let server: Server | undefined
let conn: Socket | undefined
let heartbeatTimer: NodeJS.Timeout | undefined
let wedgeTimer: NodeJS.Timeout | undefined
let wedgeDisarmed = false
let host: RvServerHost = {}

/** Send a frame to the connected supervisor. ant `no`. Returns deliverability. */
export function sendRv(frame: OutboundFrame): boolean {
  if (!conn || conn.destroyed) return false
  try {
    conn.write(encodeFrame(frame))
    return true
  } catch {
    return false
  }
}

/**
 * Start the rendezvous server. No-op if `CLAUDE_BG_RENDEZVOUS_SOCK` is
 * unset (foreground / detached sessions) or if already running. ant Rb3.
 */
export async function startRendezvousServer(
  installedHost: RvServerHost = {},
): Promise<void> {
  const sockPath = readEnv('CLAUDE_BG_RENDEZVOUS_SOCK')
  if (!sockPath || server) return
  host = installedHost
  // ant deletes the env var after reading so a nested spawn doesn't
  // inherit + try to bind the same socket.
  deleteEnv('CLAUDE_BG_RENDEZVOUS_SOCK')
  await unlink(sockPath).catch(() => {})

  server = createServer(socket => {
    // Single connection — destroy any prior. ant `lo?.destroy(); lo = _`.
    conn?.destroy()
    conn = socket
    // Run the startup-settle pass for this connection (ant Vb3).
    void runStartupSettle().catch(() => {})
    socket.on('error', () => socket.destroy())
    socket.once('close', () => {
      if (conn === socket) conn = undefined
    })
    const decode = createLineDecoder(
      msg => handleInbound(msg as InboundFrame),
      () => socket.destroy(),
    )
    socket.on('data', decode)
  })
  server.on('error', e =>
    logEvent('tengu_bg_rv_server_error', { error: String(e).slice(0, 80) }),
  )
  server.listen(sockPath)
  server.unref()

  // 30s heartbeat. ant xR_.
  heartbeatTimer = setInterval(
    () => void sendRv({ type: 'heartbeat' }),
    RV_HEARTBEAT_MS,
  )
  heartbeatTimer.unref()
}

/** Stop the server + clear all timers + drop the connection. ant Lb3. */
export function stopRendezvousServer(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = undefined
  }
  if (wedgeTimer) {
    clearTimeout(wedgeTimer)
    wedgeTimer = undefined
  }
  wedgeDisarmed = false
  conn?.destroy()
  conn = undefined
  server?.close()
  server = undefined
}

/** Handle one inbound supervisor frame. ant kb3. */
function handleInbound(frame: InboundFrame): void {
  if (!frame || typeof frame !== 'object') return
  // Handshake frame — discard (ant `if("role"in _)return`).
  if ('role' in frame) return
  const f = frame as Exclude<InboundFrame, { role: string }>
  switch (f.type) {
    case 'shutdown':
      handleShutdown()
      return
    case 'repaint':
      handleRepaint()
      return
    case 'reply':
      if (typeof f.text === 'string') handleReply(f.text)
      return
    case 'attacher-caps':
      host.applyAttacherCaps?.(f.caps)
      return
    default:
      return
  }
}

/** ant shutdown branch: ack, teardown, exit. */
function handleShutdown(): void {
  sendRv({ type: 'shutting-down' })
  if (host.onShutdown) {
    host.onShutdown()
    return
  }
  // Fallback — no host teardown installed: give the ack a moment to flush
  // then exit. ant races teardown against a 5s timeout before exit(0).
  setTimeout(() => process.exit(0), 250).unref()
}

/** ant repaint branch: forceRedraw, else hint; always ack repaint-done. */
function handleRepaint(): void {
  const redrew = host.forceRedraw?.() ?? false
  if (!redrew && !host.forceRedraw) {
    // ant writes the "can't redraw — Ctrl+Z to detach" hint to stdout when
    // forceRedraw is unavailable. The host owns stdout, so we only emit the
    // hint when there's no host redraw hook at all (best-effort).
    try {
      process.stdout.write(
        "\r\n  \x1b[2mSession can't redraw right now — Ctrl+Z to detach\x1b[0m\r\n",
      )
    } catch {
      // best-effort
    }
  }
  sendRv({ type: 'repaint-done' })
}

/** ant reply branch: answer-question short-circuit, else enqueue as prompt. */
function handleReply(text: string): void {
  if (host.answersOpenQuestion?.(text)) {
    logEvent('tengu_bg_rv_reply', {
      answered: 'true',
      len: String(text.length),
    })
    return
  }
  host.enqueueReply?.(text)
  logEvent('tengu_bg_rv_reply', {
    answered: 'false',
    len: String(text.length),
  })
}

/**
 * Startup-settle pass (ant Vb3), adapted to ccb's status machine.
 *
 * ant flips a freshly-spawned `starting`/`resuming`/`adopted`/`crashed`
 * state to `running`/`idle` on the first supervisor connection. ccb's
 * `FleetJobStatus` has NO such boot-phase states — a ccb worker boots
 * straight to `working`/`active` (writeOptimisticFleetState in bg.ts), and
 * `useBgFleetStateSync` already owns the active⇄idle transitions. So the
 * state-flip half of Vb3 is a no-op here and faithfully porting it would
 * be dead code (ccb's working/active is not ant's starting).
 *
 * What ccb DOES need from Vb3 is the startup-wedge watchdog: a worker that
 * boots but never starts its first turn (blocked on a setup/onboarding
 * dialog the supervisor can't see) should be surfaced as `blocked` rather
 * than sitting silently. ccb keys the wedge on the disarm SIGNAL (the REPL
 * calls disarmStartupWedgeWatchdog when its first turn begins), not on a
 * boot-phase detail string ccb doesn't have.
 */
async function runStartupSettle(): Promise<void> {
  const jobDir = readEnv('CLAUDE_JOB_DIR')
  if (!jobDir) return
  // Wait up to 30s (60 × 500ms) for the renderer to come up. ant loops on
  // `j5.has(process.stdout)`; ccb uses the injected isRendererReady probe.
  for (let i = 0; ; i++) {
    if (host.isRendererReady ? host.isRendererReady() : true) break
    if (i >= 60) return
    await new Promise(r => setTimeout(r, 500))
  }
  armStartupWedge(jobDir)
}

/** ant Nb3 — arm the startup-wedge watchdog (idempotent while armed). */
function armStartupWedge(jobDir: string): void {
  if (wedgeDisarmed || wedgeTimer) return
  const ms =
    Number(readEnv('CLAUDE_BG_STARTUP_WEDGE_MS')) || STARTUP_WEDGE_MS_DEFAULT
  wedgeTimer = setTimeout(() => void fireStartupWedge(jobDir), ms)
  wedgeTimer.unref()
}

/**
 * ant yb3 — wedge fired: the worker booted but never reported first-turn
 * progress within the timeout (disarm never called). Flip it to blocked so
 * FleetView surfaces "open this session to continue setup" instead of a
 * silently-stuck row. Guarded so a worker that's already doing real work
 * (already blocked) is left alone.
 */
async function fireStartupWedge(jobDir: string): Promise<void> {
  if (wedgeDisarmed) return
  const current = await readJobState(jobDir).catch(() => null)
  if (!current || current.state !== 'working' || current.tempo === 'blocked') {
    return
  }
  const next: FleetJobState = {
    ...current,
    tempo: 'blocked',
    detail: WEDGE_DETAIL,
    needs: WEDGE_NEEDS,
    updatedAt: new Date().toISOString(),
  }
  await writeJobState(jobDir, next)
  sendRv({
    type: 'state',
    patch: { tempo: 'blocked', detail: WEDGE_DETAIL, needs: WEDGE_NEEDS },
  })
}

/**
 * ant hQ8 — disarm the startup-wedge watchdog. Called once the worker has
 * made real progress (first turn started), so a slow-but-working session
 * isn't falsely flagged as wedged.
 */
export function disarmStartupWedgeWatchdog(): void {
  if (server === undefined) return
  wedgeDisarmed = true
  if (wedgeTimer) {
    clearTimeout(wedgeTimer)
    wedgeTimer = undefined
  }
}

/**
 * ant vb3 — markStartupDialogBlocked. The worker proactively reports it's
 * blocked on a startup dialog (e.g. the trust prompt) BEFORE the wedge
 * timeout. Flips state to blocked + pushes it.
 */
export async function markStartupDialogBlocked(detail?: string): Promise<void> {
  const jobDir = readEnv('CLAUDE_JOB_DIR')
  if (!jobDir || wedgeDisarmed) return
  const current = await readJobState(jobDir).catch(() => null)
  if (!current || current.tempo === 'blocked') return
  const d = detail ? `${WEDGE_DETAIL} (${detail})` : WEDGE_DETAIL
  const next: FleetJobState = {
    ...current,
    tempo: 'blocked',
    detail: d,
    needs: WEDGE_NEEDS,
    updatedAt: new Date().toISOString(),
  }
  await writeJobState(jobDir, next)
  sendRv({
    type: 'state',
    patch: { tempo: 'blocked', detail: d, needs: WEDGE_NEEDS },
  })
}

/**
 * Push an authoritative state patch + persist it. ant pushes
 * `{type:'state', patch}` after every xO write. Used by callers that own a
 * one-shot state transition (e.g. markStartupDialogBlocked siblings). The
 * REPL turn lifecycle does NOT use this — it persists via fleetStore and
 * mirrors over rv with a bare `sendRv` to avoid a redundant disk read.
 *
 * Note: ccb's rv server intentionally has no `pushRvDone`. ant's worker-
 * side rv server (4291.js) never sends `{type:'done'}` either — a worker's
 * terminal outcome flows through the PTY `exit` frame + the supervisor's
 * pid-poll, NOT the rv channel. The supervisor's rv client still HANDLES a
 * `done` frame (protocol completeness), but nothing on the worker side
 * emits one; a turn ending is not a process exit.
 */
export async function pushRvState(patch: Partial<FleetJobState>): Promise<void> {
  const jobDir = readEnv('CLAUDE_JOB_DIR')
  if (!jobDir) return
  const current = await readJobState(jobDir).catch(() => null)
  if (current) {
    await writeJobState(jobDir, {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    } as FleetJobState).catch(() => {})
  }
  sendRv({ type: 'state', patch })
}

/** True when the rendezvous server is bound (test/wiring introspection). */
export function isRendezvousServerRunning(): boolean {
  return server !== undefined
}
