/**
 * BG-daemon entry point. Boots the daemon process: binds the control
 * socket, scans existing job records, adopts running workers, and
 * services CLI RPC ops.
 *
 * Invoke:  `ccb daemon run` → `bgDaemonMain(args)`
 *
 * Mirrors ant 5172.js daemonMain for the BG path. The bridge daemon
 * lives in main.ts; this one is purely about bg-job supervision.
 *
 * @dynamicRequire
 */

import { logEvent as logEventFn } from '@claude-code/local-observability'
import { adoptFromRoster, adoptRunningPtyRecords } from './bgAdopt.js'
import {
  makeIdleActivityCount,
  setupIdleExitWatchdog,
  setupUpgradeWatchdog,
} from './bgDaemonTimers.js'
import {
  type WorkerRecord,
  readAllWorkerRecords,
  writeWorkerRecord,
} from './bgWorkerRegistry.js'
import { recordToRosterEntry, updateRoster } from './roster.js'
import { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'

/**
 * Build a no-op Socket-shaped value for fire-and-forget RPC paths (file
 * spool delivery, etc.). Returns an EventEmitter-backed object that has
 * the minimal net.Socket surface the daemon's op handlers touch:
 * `write`/`end`/`destroyed`/`once`/`on`.
 */
function makeNoopSocketForSpool(): Socket {
  const ee = new EventEmitter() as Socket
  // The op handlers only call write/end and never read the response.
  Object.assign(ee, {
    write: () => true,
    end: () => {},
    destroyed: false,
  })
  return ee
}
import { type DaemonServer, err, ok, startSocketServer } from './socketServer.js'
import { WorkerVm } from './workerVm.js'

interface PendingDispatch {
  nonce: string
  pid?: number
  acked: boolean
  failed?: { code: string; error: string }
  startedAt: number
}

interface DaemonState {
  server: DaemonServer | undefined
  workers: Map<string, WorkerVm>
  /**
   * Detached workers: kill('stop') moves vm here from `workers` so attach
   * lookup can still find it. ant: detached workers stay reachable until
   * their inner ccb exits naturally. Daemon shutdown drops all.
   */
  detached: Map<string, WorkerVm>
  /** dispatch nonces awaiting ack (short → pending). */
  pending: Map<string, PendingDispatch>
  abort: AbortController
  startedAt: number
  /** Active client leases. ant 5170.js iFK leaseCount(). */
  leases: Set<Socket>
}

interface ParsedArgs {
  jsonPath?: string
  logFile?: string
  origin?: 'transient' | 'service' | 'shell'
  spawnedBy?: string
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--json-path') out.jsonPath = args[++i]
    else if (a === '--log-file') out.logFile = args[++i]
    else if (a === '--origin') out.origin = args[++i] as ParsedArgs['origin']
    else if (a === '--spawned-by') out.spawnedBy = args[++i]
  }
  return out
}

/**
 * Boot the bg daemon. Resolves once the daemon has shut down
 * (signal or shutdown op received). Returns the daemon's exit code
 * (0 on graceful shutdown, non-zero on error).
 */
export async function bgDaemonMain(args: readonly string[]): Promise<number> {
  const parsed = parseArgs(args)
  const state: DaemonState = {
    server: undefined,
    workers: new Map(),
    detached: new Map(),
    pending: new Map(),
    abort: new AbortController(),
    startedAt: Date.now(),
    leases: new Set(),
  }

  process.title = 'ccb daemon'

  // ant 4639.js j2() reads this; ccb writes it on boot so external
  // tooling (zombie-restart, version-skew detection) can introspect.
  if (parsed.jsonPath) {
    try {
      const { writeFileSync, mkdirSync } = await import('node:fs')
      const { dirname } = await import('node:path')
      mkdirSync(dirname(parsed.jsonPath), { recursive: true })
      writeFileSync(
        parsed.jsonPath,
        JSON.stringify({
          pid: process.pid,
          startedAt: state.startedAt,
          origin: parsed.origin ?? 'transient',
          version: process.env.CLAUDE_CODE_VERSION ?? 'dev',
          spawnedBy: parsed.spawnedBy,
        }),
      )
    } catch {
      // best-effort
    }
  }

  /* adoptFromRoster + adoptRunningPtyRecords live in ./bgAdopt.ts */
  logEventFn('tengu_bg_daemon_boot', {
    pid: String(process.pid),
    origin: parsed.origin ?? 'transient',
  })
  // ant 5170.js iFK:219 — daemon_start fires once after the supervisor
  // has bound its control socket and is ready to accept ops. ccb's
  // worker_kinds and worker_count map to "0/0" since this is the
  // bg-only supervisor (no remoteControl/bridge sub-workers).
  logEventFn('tengu_daemon_start', {
    worker_kinds: '0',
    worker_count: '0',
    origin: parsed.origin ?? 'transient',
  })
  if (process.env.CLAUDE_CODE_BG_SPARE_POOL === '1') {
    const { enableSparePool, shouldPrewarm, setPrewarmInFlight, recordSpareSpawn, markSpareReady } = await import('./sparePool.js')
    enableSparePool()
    // Pre-warm scheduler: every 30s, if no spare exists + no in-flight,
    // spawn one. ant 4644.js iw6.
    const prewarmTimer = setInterval(() => {
      if (!shouldPrewarm()) return
      setPrewarmInFlight(true)
      void (async () => {
        try {
          const { randomUUID } = await import('node:crypto')
          const sessionId = randomUUID()
          const short = sessionId.slice(0, 8)
          const cwd = process.cwd()
          // Spawn spare via existing spawnPtyHost path in bg.ts.
          const { spawnPtyHost } = await import('@claude-code/cli/bg/spawnPty.js')
          const { mkdirSync } = await import('node:fs')
          const { join } = await import('node:path')
          const { homedir } = await import('node:os')
          const jobDir = join(homedir(), '.claude', 'jobs', short)
          mkdirSync(jobDir, { recursive: true })
          const r = spawnPtyHost({
            short,
            jobDir,
            flags: [],
            directive: '(idle — waiting for trigger)',
            cwd,
          })
          recordSpareSpawn(short, cwd, sessionId, r.socketPath)
          // Wait for the worker's PTY socket to come up (proxy for ready).
          // Poll for socket-file existence then mark ready.
          const { existsSync } = await import('node:fs')
          for (let i = 0; i < 50; i++) {
            await new Promise(res => setTimeout(res, 100))
            if (existsSync(r.socketPath)) {
              markSpareReady(short)
              break
            }
          }
        } catch (e) {
          logEventFn('tengu_bg_spare_claim_fail', { reason: 'prewarm-spawn-failed', error: (e as Error).message.slice(0, 80) })
        } finally {
          setPrewarmInFlight(false)
        }
      })()
    }, 30_000)
    prewarmTimer.unref()
  }
  // Boot scan + every-5s rescan for workers spawned outside our spawn op
  // (e.g. ccb --bg-pty fired by user). ant 5172.js sweep cadence.
  // Two source-of-truth: (1) jobs/<short>/meta.json (always authoritative
  // for status), (2) ~/.claude/daemon/roster.json (cross-cwd index of live
  // supervisors — survives daemon restart). Adopt from both then unify.
  await adoptFromRoster(state.workers)
  adoptRunningPtyRecords(state.workers)
  // After boot adopt, snapshot the current workers map back to roster.json
  // so a parallel observer (ccb doctor) sees the new supervisor's view.
  void updateRoster(r => {
    r.workers = {}
    for (const [s, vm] of state.workers) r.workers[s] = recordToRosterEntry(vm.getRecord())
  }).catch(() => {})
  const adoptTimer = setInterval(() => adoptRunningPtyRecords(state.workers), 5000)
  adoptTimer.unref()
  // Periodic roster refresh (catches state changes that don't go through
  // our spawn/settle handlers — e.g. record mutated by external tooling).
  const rosterTimer = setInterval(() => {
    void updateRoster(r => {
      r.workers = {}
      for (const [s, vm] of state.workers) r.workers[s] = recordToRosterEntry(vm.getRecord())
    }).catch(() => {})
  }, 30_000)
  rosterTimer.unref()

  // ant 5170.js iFK:172-193 + 130-167+244 — idle-exit watchdog +
  // self-restart on binary upgrade. Implementations live in
  // ./bgDaemonTimers.ts to keep this file under the 800-LOC budget.
  const idleExit = setupIdleExitWatchdog({
    origin: parsed.origin ?? 'transient',
    abort: state.abort,
    graceMs: 5_000,
    countActivity: makeIdleActivityCount(state),
  })
  const idleProbeTimer = setInterval(idleExit.probe, 2_000)
  idleProbeTimer.unref()
  const upgradeWatchdog = setupUpgradeWatchdog(state.abort)

  // Wire socket op handlers. Captured into a variable so the dispatch
  // file-spool watcher (ant 5165.js) can reuse the same handler table.
  const opHandlers = {
    ping: async () =>
      ok({ op: 'ping', uptime: Date.now() - state.startedAt }),
    nudge: async () => ok({ op: 'nudge', restarting: false }),
    list: async () => {
      const { readState } = await import('./classifier/stateFile.js')
      interface JobEntry {
        short: string
        pid: number
        status: string
        phase: string
        mode?: string
        startedAt: number
        attachers: number
        classifierState?: string
        classifierTempo?: string
        classifierDetail?: string
        classifierNeeds?: string
        detached?: boolean
      }
      const buildEntry = (vm: WorkerVm, isDetached: boolean): JobEntry => {
        const r = vm.getRecord()
        const cs = readState(r.short)
        const j: JobEntry = {
          short: r.short,
          pid: r.pid,
          status: r.status,
          phase: vm.getPhase().kind,
          mode: r.mode,
          startedAt: r.startedAt,
          attachers: vm.attacherCount(),
          ...(isDetached && { detached: true }),
        }
        if (cs) {
          j.classifierState = cs.state
          j.classifierTempo = cs.tempo
          j.classifierDetail = cs.detail
          if (cs.needs) j.classifierNeeds = cs.needs
        }
        return j
      }
      const jobs: JobEntry[] = [
        ...[...state.workers.values()].map(vm => buildEntry(vm, false)),
        ...[...state.detached.values()].map(vm => buildEntry(vm, true)),
      ]
      // Also surface non-running records (recently exited). Skip if
      // the worker is already in the live or detached map — otherwise a
      // detached worker that still has a meta.json under jobs/<short>/
      // would appear twice (once with detached:true, once as 'retired').
      for (const record of readAllWorkerRecords()) {
        if (state.workers.has(record.short)) continue
        if (state.detached.has(record.short)) continue
        jobs.push({
          short: record.short,
          pid: record.pid,
          status: record.status,
          phase: 'retired',
          mode: record.mode,
          startedAt: record.startedAt,
          attachers: 0,
        })
      }
      return ok({ op: 'list', jobs })
    },
    spawn: async msg => {
      // payload: { d: { short, cwd, ptySocket, cmd, env, cliVersion, dispatch } }
      const d = (msg.d ?? msg) as Record<string, unknown>
      const short = d.short as string | undefined
      if (!short) return err('EBADREQ', 'spawn: missing short')
      if (state.workers.has(short)) {
        return err('EALIVE', `worker ${short} already running`, { short })
      }
      const vm = new WorkerVm({
        short,
        cwd: (d.cwd as string) ?? process.cwd(),
        env: (d.env as NodeJS.ProcessEnv) ?? process.env,
        ptySocket: (d.ptySocket as string) ?? '',
        rvSocket: d.rvSocket as string | undefined,
        cmd: (d.cmd as string[]) ?? [],
        cliVersion: (d.cliVersion as string) ?? process.env.CLAUDE_CODE_VERSION ?? 'dev',
        dispatch: d.dispatch as Record<string, unknown> | undefined,
      })
      state.workers.set(short, vm)
      vm.on('settled', () => {
        // Keep settled vm one tick so list still surfaces it; then drop + de-roster.
        setTimeout(() => state.workers.delete(short), 100).unref()
        void updateRoster(r => {
          delete r.workers[short]
        }).catch(() => {})
      })
      vm.spawn()
      // Start classifier orchestrator if gate is on (intent unknown for spawn op).
      void import('./classifier/orchestrator.js').then(m => m.startOrchestrator(vm)).catch(() => {})
      // Persist into roster so a subsequent supervisor restart picks
      // this worker up via adoptFromRoster (cross-cwd visibility).
      void updateRoster(r => {
        r.workers[short] = recordToRosterEntry(vm.getRecord())
      }).catch(() => {})
      return ok({ op: 'spawn', short, pid: vm.getRecord().pid })
    },
    /**
     * dispatch — ant 4138.js / 4648.js MC8. Spawn a worker for `short`
     * with a nonce; client follows up with `await-ack` to block for
     * confirmation that the worker accepted the directive.
     */
    dispatch: async msg => {
      const d = (msg.d ?? msg) as Record<string, unknown>
      const short = d.short as string | undefined
      const nonce = d.nonce as string | undefined
      if (!short) {
        logEventFn('tengu_bg_dispatch_rejected', { reason: 'missing_short' })
        return err('EBADREQ', 'dispatch: missing short')
      }
      if (!nonce) {
        logEventFn('tengu_bg_dispatch_rejected', { short, reason: 'missing_nonce' })
        return err('EBADREQ', 'dispatch: missing nonce')
      }
      if (state.workers.has(short)) {
        logEventFn('tengu_bg_dispatch_rejected', { short, reason: 'already_running' })
        return err('EALIVE', `worker ${short} already running`, { short })
      }
      // Port of ant v2.1.133 NdK (5196.js) — free-memory cap before spawn.
      // When the host's available RAM drops below `tengu_bg_low_mem_mb`
      // (default 1024MB; macOS exempted because vm_stat semantics don't
      // line up with os.freemem and would cause spurious retires), call
      // retireIfSettled on every existing worker to reclaim memory before
      // taking on another. On Linux/Windows we always check — the kernel
      // tries to over-commit, so spawning one more bg session in a
      // memory-starved system is what typically tips it into the OOM
      // killer or thrashing. Emit telemetry so the threshold can be
      // tuned per environment.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const os = require('node:os') as typeof import('node:os')
        const platform = os.platform()
        // Read threshold from env. Daemon's cross-package coupling
        // budget keeps it independent of @claude-code/config, so we
        // avoid the GrowthBook flag and gate via env only.
        // CLAUDE_CODE_BG_LOW_MEM_MB overrides the default (1024 MB on
        // Linux/Win, 0 on macOS — vm_stat semantics don't line up
        // with os.freemem and would cause spurious retires).
        // eslint-disable-next-line custom-rules/no-process-env-top-level
        const envOverride = Number(process.env.CLAUDE_CODE_BG_LOW_MEM_MB)
        const thresholdMb =
          platform === 'darwin'
            ? Number.isFinite(envOverride)
              ? envOverride
              : 0
            : Number.isFinite(envOverride)
              ? envOverride
              : 1024
        if (thresholdMb > 0) {
          const thresholdBytes = thresholdMb * 1024 * 1024
          const freeBytes = os.freemem()
          if (freeBytes < thresholdBytes) {
            let retired = 0
            for (const [s, w] of state.workers.entries()) {
              const retireIfSettled = (
                w as { retireIfSettled?: () => boolean }
              ).retireIfSettled
              if (typeof retireIfSettled === 'function') {
                if (retireIfSettled.call(w)) {
                  retired++
                  state.workers.delete(s)
                  state.pending.delete(s)
                }
              }
            }
            logEventFn('tengu_bg_dispatch_low_mem', {
              free_mb: String(Math.floor(freeBytes / (1024 * 1024))),
              handles: String(state.workers.size),
              retired: String(retired),
              threshold_mb: String(thresholdMb),
            })
          }
        }
      } catch {
        // Low-mem check must not block legitimate dispatch — fall through.
      }
      // ant 4644.js: try claim spare before fresh spawn. If a ready spare
      // matches cwd, send 'claim' ctrl-frame with the dispatched intent
      // so the running spare picks it up; skip fresh spawn.
      const { claimSpare } = await import('./sparePool.js')
      const claim = claimSpare((d.cwd as string) ?? process.cwd())
      if (claim.ok) {
        const intent = (d.intent as string) ?? (d.directive as string) ?? ''
        const { connect } = await import('node:net')
        const { encodeCtrlFrame } = await import('@claude-code/cli/bg/ptyFrame.js')
        try {
          await new Promise<void>((resolve, reject) => {
            const sock = connect(claim.ptySocket)
            sock.once('connect', () => {
              sock.write(encodeCtrlFrame({ t: 'claim', intent, cwd: (d.cwd as string), sessionId: claim.sessionId }))
              sock.end()
              resolve()
            })
            sock.once('error', e => reject(e))
          })
          // The spare worker keeps running with its existing short — return
          // its short instead of spawning fresh.
          state.pending.set(claim.short, { nonce, acked: true, pid: undefined, startedAt: Date.now() })
          logEventFn('tengu_bg_dispatch', {
            backend_daemon: 'true',
            via: 'spare-claim',
            short: claim.short,
            ms: '0',
          })
          return ok({ op: 'dispatch', short: claim.short, nonce, pid: -1, via: 'spare-claim' })
        } catch (e) {
          // Claim send failed → fall through to fresh spawn.
          logEventFn('tengu_bg_sendclaim_failed', { reason: 'connect-error', short: claim.short, error: (e as Error).message.slice(0, 80) })
        }
      }
      const vm = new WorkerVm({
        short,
        cwd: (d.cwd as string) ?? process.cwd(),
        env: (d.env as NodeJS.ProcessEnv) ?? process.env,
        ptySocket: (d.ptySocket as string) ?? '',
        rvSocket: d.rvSocket as string | undefined,
        cmd: (d.cmd as string[]) ?? [],
        cliVersion: (d.cliVersion as string) ?? process.env.CLAUDE_CODE_VERSION ?? 'dev',
        dispatch: d as Record<string, unknown>,
      })
      state.workers.set(short, vm)
      const pending: PendingDispatch = { nonce, acked: false, startedAt: Date.now() }
      state.pending.set(short, pending)
      vm.on('settled', (outcome: string) => {
        // ant respawn_unconfirmed_bail: if dispatch settled before ack
        // budget elapsed, mark failed so await-ack returns the real
        // error instead of timing out.
        if (!pending.acked) {
          pending.failed = { code: 'ECRASHED', error: `worker ${short} settled before ack: ${outcome}` }
          logEventFn('tengu_bg_respawn_unconfirmed_bail', { short, outcome, ms: String(Date.now() - pending.startedAt) })
        }
        setTimeout(() => { state.workers.delete(short); state.pending.delete(short) }, 100).unref()
        void updateRoster(r => { delete r.workers[short] }).catch(() => {})
      })
      vm.spawn()
      void updateRoster(r => {
        r.workers[short] = recordToRosterEntry(vm.getRecord())
      }).catch(() => {})
      // Start classifier orchestrator with intent (the dispatch directive).
      void import('./classifier/orchestrator.js').then(m => m.startOrchestrator(vm, (d.directive as string | undefined) ?? (d.intent as string | undefined))).catch(() => {})
      setTimeout(() => {
        if (pending.acked || pending.failed) return
        if (state.workers.get(short) === vm) {
          pending.pid = vm.getRecord().pid
          pending.acked = true
          logEventFn('tengu_bg_dispatch_rescued', { short, ms: String(Date.now() - pending.startedAt) })
        }
      }, 5000).unref()
      return ok({ op: 'dispatch', short, nonce, pid: vm.getRecord().pid, via: 'socket' })
    },
    'await-ack': async msg => {
      const short = msg.short as string | undefined
      const nonce = msg.nonce as string | undefined
      if (!short) return err('EBADREQ', 'await-ack: missing short')
      if (!nonce) return err('EBADREQ', 'await-ack: missing nonce')
      const pending = state.pending.get(short)
      if (!pending) return err('ENOCONN', `no pending dispatch for ${short}`)
      if (pending.nonce !== nonce) return err('ESTALE', `nonce mismatch for ${short}`)
      if (pending.failed) return err(pending.failed.code, pending.failed.error)
      if (!pending.acked) return err('ESTARTING', `worker ${short} not yet acked`)
      const vm = state.workers.get(short)
      const messagingSock = vm?.getRecord().ptySocket ?? ''
      return ok({ op: 'await-ack', short, nonce, pid: pending.pid, messagingSock, via: 'socket' })
    },
    /**
     * reply — ant 4643.js cw6. Send `text` as a queued user prompt to
     * a running worker via its PTY socket. Used by spare claim flow
     * (intent injection) and `ccb reply <short> "<text>"` (deferred).
     * On ESTARTING, retry up to 10x at 200ms apart.
     */
    reply: async msg => {
      const short = msg.short as string | undefined
      const text = msg.text as string | undefined
      if (!short) return err('EBADREQ', 'reply: missing short')
      if (text === undefined) return err('EBADREQ', 'reply: missing text')
      // Reply can target detached workers too (they're still running
      // their inner ccb, daemon just stopped supervising).
      const vm = state.workers.get(short) ?? state.detached.get(short)
      if (!vm) return err('ENOJOB', `no worker for short ${short}`)
      const ptySocket = vm.getRecord().ptySocket
      if (!ptySocket) return err('ENOSOCK', `worker ${short} has no ptySocket`)
      // Open client connection to worker's PTY socket + send 'reply' ctrl-frame.
      const { connect } = await import('node:net')
      const { encodeCtrlFrame } = await import('@claude-code/cli/bg/ptyFrame.js')
      return new Promise<{ ok: true; op: 'reply' } | { ok: false; code: string; error: string }>(resolve => {
        const sock = connect(ptySocket)
        sock.once('connect', () => {
          sock.write(encodeCtrlFrame({ t: 'reply', text }))
          sock.end()
          logEventFn('tengu_bg_agent_action', { action: 'reply', short, daemon: 'true' })
          resolve(ok({ op: 'reply' }) as { ok: true; op: 'reply' })
        })
        sock.once('error', e => {
          resolve(err('ENOCONN', `pty socket connect failed: ${(e as Error).message}`) as { ok: false; code: string; error: string })
        })
      })
    },
    /**
     * sendclaim — ant 4644.js cw6 spare claim path. Same wire protocol
     * as `reply` but uses `claim` ctrl-frame so the worker knows it's a
     * spare-handoff (lets future worker-side spare-wait mode trigger
     * session re-init). Today the inner ccb treats both identically;
     * the distinction is preserved for telemetry + future worker-side.
     */
    sendclaim: async msg => {
      const short = msg.short as string | undefined
      const intent = msg.intent as string | undefined
      const cwd = msg.cwd as string | undefined
      const sessionId = msg.sessionId as string | undefined
      if (!short || !intent) {
        logEventFn('tengu_bg_sendclaim_failed', { reason: 'missing-args' })
        return err('EBADREQ', 'sendclaim: missing short or intent')
      }
      const vm = state.workers.get(short)
      if (!vm) {
        logEventFn('tengu_bg_sendclaim_failed', { reason: 'no-worker', short })
        return err('ENOJOB', `no worker for short ${short}`)
      }
      const ptySocket = vm.getRecord().ptySocket
      if (!ptySocket) {
        logEventFn('tengu_bg_sendclaim_failed', { reason: 'no-sock', short })
        return err('ENOSOCK', `worker ${short} has no ptySocket`)
      }
      const { connect } = await import('node:net')
      const { encodeCtrlFrame } = await import('@claude-code/cli/bg/ptyFrame.js')
      return new Promise<{ ok: true; op: 'sendclaim' } | { ok: false; code: string; error: string }>(resolve => {
        const sock = connect(ptySocket)
        sock.once('connect', () => {
          sock.write(encodeCtrlFrame({ t: 'claim', intent, cwd, sessionId }))
          sock.end()
          resolve(ok({ op: 'sendclaim' }) as { ok: true; op: 'sendclaim' })
        })
        sock.once('error', e => {
          logEventFn('tengu_bg_sendclaim_failed', { reason: 'connect-error', short, error: (e as Error).message.slice(0, 80) })
          resolve(err('ENOCONN', `pty socket connect failed: ${(e as Error).message}`) as { ok: false; code: string; error: string })
        })
      })
    },
    kill: async msg => {
      const short = msg.short as string | undefined
      if (!short) return err('EBADREQ', 'kill: missing short')
      const vm = state.workers.get(short)
      if (!vm) return err('ENOJOB', `no worker for short ${short}`)
      const force = msg.force as boolean | undefined
      vm.kill(force ? 'reap' : 'grace')
      return ok({ op: 'kill', confirmed: true })
    },
    /**
     * respawn-stalled — ant 5164.js wF3. CLI's attach client calls this
     * when it detects stall (no first frame within ATTACH_STALL_THRESHOLD_MS).
     * Increments attachStallRespawns counter; if counter ≥1 already (i.e.
     * already respawned once), refuses with EGAVEUP so client gives up.
     * Otherwise: SIGKILL the worker, respawn fresh with bumped counter.
     */
    'respawn-stalled': async msg => {
      const short = msg.short as string | undefined
      if (!short) return err('EBADREQ', 'respawn-stalled: missing short')
      const vm = state.workers.get(short)
      if (!vm) return err('ENOJOB', `no worker for short ${short}`)
      const oldRecord = vm.getRecord()
      const attempts = oldRecord.attachStallRespawns ?? 0
      if (attempts >= 1) {
        // Second stall — give up. Client decides whether to surface error.
        logEventFn('tengu_bg_attach_stall_gave_up', { short, attempts: String(attempts) })
        return err('EGAVEUP', `worker ${short} stalled ${attempts} time(s); not respawning again`)
      }
      logEventFn('tengu_bg_attach_stall_respawn', { short, attempts: String(attempts) })
      vm.kill('reap') // SIGKILL — stalled worker won't respond to grace
      await new Promise(r => setTimeout(r, 200))
      const fresh = new WorkerVm({
        short: oldRecord.short,
        cwd: oldRecord.cwd,
        env: process.env,
        ptySocket: oldRecord.ptySocket ?? '',
        cmd: oldRecord.cmd,
        cliVersion: process.env.CLAUDE_CODE_VERSION ?? 'dev',
      })
      // Carry over the bumped counter so a 2nd stall on this respawned
      // worker exits via EGAVEUP path above.
      const freshRecord = fresh.getRecord()
      freshRecord.attachStallRespawns = attempts + 1
      state.workers.set(short, fresh)
      fresh.spawn()
      void updateRoster(r => {
        r.workers[short] = recordToRosterEntry(fresh.getRecord())
      }).catch(() => {})
      return ok({ op: 'respawn-stalled', short, pid: fresh.getRecord().pid, attempts: attempts + 1 })
    },
    respawn: async msg => {
      const short = msg.short as string | undefined
      if (!short) return err('EBADREQ', 'respawn: missing short')
      const vm = state.workers.get(short)
      if (!vm) return err('ENOJOB', `no worker for short ${short}`)
      const oldPid = vm.getRecord().pid
      // Force-kill old, then re-spawn with same short id.
      vm.kill('reap')
      // Wait briefly for the old to settle, then spawn fresh.
      await new Promise(r => setTimeout(r, 100))
      const oldRecord = vm.getRecord()
      // ant respawn_stale: oldPid changed between kill schedule and now
      // means another writer reaped + respawned in parallel.
      if (oldRecord.pid !== oldPid) {
        logEventFn('tengu_bg_respawn_stale', { short, expected_pid: String(oldPid), actual_pid: String(oldRecord.pid) })
      }
      const fresh = new WorkerVm({
        short: oldRecord.short,
        cwd: oldRecord.cwd,
        env: process.env,
        ptySocket: oldRecord.ptySocket ?? '',
        cmd: oldRecord.cmd,
        cliVersion: process.env.CLAUDE_CODE_VERSION ?? 'dev',
      })
      state.workers.set(short, fresh)
      fresh.spawn()
      void updateRoster(r => {
        r.workers[short] = recordToRosterEntry(fresh.getRecord())
      }).catch(() => {})
      return ok({ op: 'respawn', short, pid: fresh.getRecord().pid })
    },
    retire: async msg => {
      const short = msg.short as string | undefined
      if (!short) return err('EBADREQ', 'retire: missing short')
      const vm = state.workers.get(short)
      if (!vm) return err('ENOJOB', `no worker for short ${short}`)
      vm.kill('grace')
      return ok({ op: 'retire', short, retired: true })
    },
    /**
     * detach — ant: vm.kill('stop') doesn't kill the worker, just makes
     * daemon forget about it. Move from active workers map → detached map
     * so subsequent attach lookup can still find it. Worker keeps running
     * until its inner ccb exits naturally or daemon restarts.
     */
    detach: async msg => {
      const short = msg.short as string | undefined
      if (!short) return err('EBADREQ', 'detach: missing short')
      const vm = state.workers.get(short)
      if (!vm) return err('ENOJOB', `no worker for short ${short}`)
      vm.kill('stop')
      state.workers.delete(short)
      state.detached.set(short, vm)
      vm.on('settled', () => {
        setTimeout(() => state.detached.delete(short), 100).unref()
      })
      // Detached workers stop being supervised; drop from roster so a
      // daemon restart doesn't try to re-adopt them.
      void updateRoster(r => { delete r.workers[short] }).catch(() => {})
      return ok({ op: 'detach', short, detached: true })
    },
    shutdown: async () => {
      logEventFn('tengu_bg_daemon_shutdown', {
        uptime_ms: String(Date.now() - state.startedAt),
        workers: String(state.workers.size),
      })
      // Schedule shutdown after this reply is sent.
      setImmediate(() => state.abort.abort()).unref()
      return ok({ op: 'shutdown', accepted: true })
    },
    /**
     * yield — ant 5170.js iFK:50-62. A new daemon launching with
     * non-transient origin (service/shell) asks the running transient
     * daemon to step aside. Transient yields; non-transient refuses.
     *
     * The takeover flow is: new daemon sends `yield` → we set
     * `yieldRequested=true`, schedule an abort after a short grace, and
     * return ok with `yielding:true`. The new daemon polls for our
     * lock release and emits tengu_daemon_yield_takeover.
     */
    yield: async () => {
      const myOrigin = parsed.origin ?? 'transient'
      if (myOrigin !== 'transient') {
        return ok({ op: 'yield', yielding: false, origin: myOrigin })
      }
      logEventFn('tengu_daemon_yield', {})
      // Grace period so the in-flight ack actually flushes before we
      // tear down the socket server.
      setTimeout(() => state.abort.abort(), 200).unref()
      return ok({ op: 'yield', yielding: true, origin: myOrigin })
    },
    lease: async (msg, socket) => {
      // Hold the connection open; daemon counts this as an active
      // client. The socket stays alive until the client disconnects
      // (server's close handler observes the drop). ant 5170.js
      // tracks leaseCount + emits tengu_daemon_lease per ack.
      state.leases.add(socket)
      const onClose = (): void => {
        state.leases.delete(socket)
      }
      socket.once('close', onClose)
      socket.once('error', onClose)
      const client = (msg.client as Record<string, unknown> | undefined) ?? {}
      logEventFn('tengu_daemon_lease', {
        label: typeof client.label === 'string' ? client.label : 'unknown',
        cwd: typeof client.cwd === 'string' ? client.cwd : '',
        client_pid: typeof client.pid === 'number' ? String(client.pid) : '0',
        leases: String(state.leases.size),
      })
      socket.write('') // no-op write to confirm liveness
      return undefined
    },
    subscribe: async (msg, socket) => {
      const short = msg.short as string | undefined
      if (!short) return err('EBADREQ', 'subscribe: missing short')
      // Allow re-attach to detached workers (the entire point of detach).
      const vm = state.workers.get(short) ?? state.detached.get(short)
      if (!vm) return err('ENOJOB', `no worker for short ${short}`)
      // Send snapshot, then live updates.
      socket.write(
        JSON.stringify({
          ok: true,
          type: 'snapshot',
          short,
          streamTail: vm.getRingSnapshot().map(b => b.toString('utf8')),
        }) + '\n',
      )
      const remove = vm.addAttacher({
        write(chunk: Buffer | string) {
          const buf =
            typeof chunk === 'string' ? Buffer.from(chunk) : chunk
          return socket.write(
            JSON.stringify({
              ok: true,
              type: 'data',
              short,
              data: buf.toString('utf8'),
            }) + '\n',
          )
        },
        end() {
          socket.end()
        },
      })
      socket.once('close', remove)
      return undefined
    },
  }
  state.server = await startSocketServer(opHandlers)

  // ant 5165.js — file-spool dispatch fallback. CLI writes envelopes
  // to ~/.claude/daemon/dispatch/ when socket is unreachable; daemon
  // ingests them on boot + on fs.watch events. Survives daemon restart
  // between CLI write and daemon read.
  const { drainSpool, startSpoolWatcher } = await import('./dispatchSpool.js')
  const deliverSpooled = async (env: { op: string; d: Record<string, unknown>; nonce?: string }): Promise<void> => {
    const handler = opHandlers[env.op as keyof typeof opHandlers]
    if (typeof handler !== 'function') return
    // No-op socket — file-spool envelopes are one-shot, no client to reply to.
    // Build a minimal net.Socket-shaped value via EventEmitter so the
    // assignment is structural (no cast) and the handler's fire-and-forget
    // runtime path stays satisfied.
    const noopSocket: Parameters<typeof handler>[1] =
      makeNoopSocketForSpool()
    await handler({ ...env.d, op: env.op, ...(env.nonce && { nonce: env.nonce }) }, noopSocket)
  }
  await drainSpool(deliverSpooled)
  const spoolWatcher = startSpoolWatcher(deliverSpooled)

  // SIGINT / SIGTERM → graceful shutdown.
  const onSignal = (): void => state.abort.abort()
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  // ant 5170 — SIGHUP triggers config reload. ccb has no daemon.json
  // today, so we fire the telemetry + log a notice so users can hook
  // the signal for their own purposes (and so the event namespace
  // matches ant for any tooling that watches the wire).
  const onSighup = (): void => {
    logEventFn('tengu_daemon_config_reload', { source: 'SIGHUP' })
  }
  process.on('SIGHUP', onSighup)

  await new Promise<void>(resolve => {
    if (state.abort.signal.aborted) {
      resolve()
      return
    }
    state.abort.signal.addEventListener('abort', () => resolve(), {
      once: true,
    })
  })

  process.off('SIGINT', onSignal)
  process.off('SIGTERM', onSignal)
  process.off('SIGHUP', onSighup)
  // Dispose idle-exit + upgrade watchdog timers so they don't keep
  // the event loop alive after abort.
  clearInterval(idleProbeTimer)
  idleExit.dispose()
  upgradeWatchdog.dispose()

  // ant tengu_bg_dispatch_stale_drop: in-flight dispatches the daemon
  // can't see through. Mark pending entries failed before close.
  for (const [short, p] of state.pending.entries()) {
    if (p.acked || p.failed) continue
    p.failed = { code: 'ESHUTDOWN', error: 'daemon shutting down' }
    logEventFn('tengu_bg_dispatch_stale_drop', { short, ms: String(Date.now() - p.startedAt) })
  }

  // Force-settle workers, persist final state, close server.
  for (const vm of state.workers.values()) {
    vm.forceSettle('killed')
    const r = vm.getRecord()
    try {
      writeWorkerRecord({ ...r, status: 'killed', killedAt: Date.now() } as WorkerRecord)
    } catch {
      // best-effort
    }
  }
  if (parsed.jsonPath) {
    try {
      const { unlinkSync } = await import('node:fs')
      unlinkSync(parsed.jsonPath)
    } catch {
      // best-effort
    }
  }
  spoolWatcher.close()
  await state.server?.close()
  return 0
}
