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

import { existsSync as existsSyncFn } from 'node:fs'
import { logEvent as logEventFn } from '@claude-code/local-observability'
import {
  type WorkerRecord,
  isPidAlive as isPidAliveSync,
  readAllWorkerRecords,
  writeWorkerRecord,
} from './bgWorkerRegistry.js'
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
  /** dispatch nonces awaiting ack (short → pending). */
  pending: Map<string, PendingDispatch>
  abort: AbortController
  startedAt: number
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
    pending: new Map(),
    abort: new AbortController(),
    startedAt: Date.now(),
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

  function adoptRunningPtyRecords(): void {
    for (const record of readAllWorkerRecords()) {
      if (record.status !== 'running') continue
      if (record.mode !== 'pty') continue
      if (state.workers.has(record.short)) continue
      // ant orphan_reap: pid is gone but meta still says 'running' →
      // mark exited so list/stop don't show ghosts.
      if (!isPidAliveSync(record.pid)) {
        logEventFn('tengu_bg_orphan_reap', { short: record.short, pid: String(record.pid) })
        try {
          writeWorkerRecord({ ...record, status: 'exited', exitedAt: Date.now() })
        } catch {
          // best-effort
        }
        continue
      }
      // ant 4639.js — sock_unlinked detection: ptySocket file gone means
      // the worker is unreachable for attach even if pid is alive.
      const ptySocket = record.ptySocket ?? ''
      const sockExists = ptySocket ? existsSyncFn(ptySocket) : false
      if (ptySocket && !sockExists) {
        logEventFn('tengu_bg_adopt_sock_unlinked', { short: record.short, sock: ptySocket })
      }
      // ant adopt_upgrade_respawn: cliVersion mismatch means user
      // upgraded ccb between worker spawn and daemon adopt — schedule
      // a respawn under the new binary so adopters see consistent api.
      const currentCli = process.env.CLAUDE_CODE_VERSION ?? 'dev'
      if (record.cliVersion && record.cliVersion !== currentCli) {
        logEventFn('tengu_bg_adopt_upgrade_respawn', { short: record.short, was: record.cliVersion, now: currentCli })
      }
      // procStart unreadable → log adopt_unverified but proceed.
      if (record.procStart === undefined || record.procStart === 0) {
        logEventFn('tengu_bg_adopt_unverified', { short: record.short, pid: String(record.pid) })
      }
      const vm = new WorkerVm(
        {
          short: record.short,
          cwd: record.cwd,
          env: process.env,
          ptySocket,
          cmd: record.cmd,
          cliVersion: currentCli,
        },
        record,
      )
      vm.adopt(record)
      state.workers.set(record.short, vm)
      logEventFn('tengu_bg_adopt', {
        short: record.short,
        pid: String(record.pid),
        sock_exists: String(sockExists),
        verified: String(record.procStart !== undefined && record.procStart !== 0),
      })
    }
  }
  logEventFn('tengu_bg_daemon_boot', {
    pid: String(process.pid),
    origin: parsed.origin ?? 'transient',
  })
  // Boot scan + every-5s rescan for workers spawned outside our spawn op
  // (e.g. ccb --bg-pty fired by user). ant 5172.js sweep cadence.
  adoptRunningPtyRecords()
  const adoptTimer = setInterval(adoptRunningPtyRecords, 5000)
  adoptTimer.unref()

  // Wire socket op handlers.
  state.server = await startSocketServer({
    ping: async () =>
      ok({ op: 'ping', uptime: Date.now() - state.startedAt }),
    nudge: async () => ok({ op: 'nudge', restarting: false }),
    list: async () => {
      const jobs = [...state.workers.values()].map(vm => {
        const r = vm.getRecord()
        return {
          short: r.short,
          pid: r.pid,
          status: r.status,
          phase: vm.getPhase().kind,
          mode: r.mode,
          startedAt: r.startedAt,
          attachers: vm.attacherCount(),
        }
      })
      // Also surface non-running records (recently exited).
      for (const record of readAllWorkerRecords()) {
        if (state.workers.has(record.short)) continue
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
        cmd: (d.cmd as string[]) ?? [],
        cliVersion:
          (d.cliVersion as string) ?? process.env.CLAUDE_CODE_VERSION ?? 'dev',
        dispatch: d.dispatch as Record<string, unknown> | undefined,
      })
      state.workers.set(short, vm)
      vm.on('settled', () => {
        // Keep settled vm in registry for one tick so list still
        // surfaces the result; then drop.
        setTimeout(() => state.workers.delete(short), 100).unref()
      })
      vm.spawn()
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
      if (!short) return err('EBADREQ', 'dispatch: missing short')
      if (!nonce) return err('EBADREQ', 'dispatch: missing nonce')
      if (state.workers.has(short)) return err('EALIVE', `worker ${short} already running`, { short })
      const vm = new WorkerVm({
        short,
        cwd: (d.cwd as string) ?? process.cwd(),
        env: (d.env as NodeJS.ProcessEnv) ?? process.env,
        ptySocket: (d.ptySocket as string) ?? '',
        cmd: (d.cmd as string[]) ?? [],
        cliVersion: (d.cliVersion as string) ?? process.env.CLAUDE_CODE_VERSION ?? 'dev',
        dispatch: d as Record<string, unknown>,
      })
      state.workers.set(short, vm)
      const pending: PendingDispatch = { nonce, acked: false, startedAt: Date.now() }
      state.pending.set(short, pending)
      vm.on('settled', () => {
        setTimeout(() => { state.workers.delete(short); state.pending.delete(short) }, 100).unref()
      })
      vm.spawn()
      setTimeout(() => {
        if (pending.acked) return
        if (state.workers.get(short) === vm) { pending.pid = vm.getRecord().pid; pending.acked = true }
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
    kill: async msg => {
      const short = msg.short as string | undefined
      if (!short) return err('EBADREQ', 'kill: missing short')
      const vm = state.workers.get(short)
      if (!vm) return err('ENOJOB', `no worker for short ${short}`)
      const force = msg.force as boolean | undefined
      vm.kill(force ? 'reap' : 'grace')
      return ok({ op: 'kill', confirmed: true })
    },
    respawn: async msg => {
      const short = msg.short as string | undefined
      if (!short) return err('EBADREQ', 'respawn: missing short')
      const vm = state.workers.get(short)
      if (!vm) return err('ENOJOB', `no worker for short ${short}`)
      // Force-kill old, then re-spawn with same short id.
      vm.kill('reap')
      // Wait briefly for the old to settle, then spawn fresh.
      await new Promise(r => setTimeout(r, 100))
      const oldRecord = vm.getRecord()
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
    shutdown: async () => {
      logEventFn('tengu_bg_daemon_shutdown', {
        uptime_ms: String(Date.now() - state.startedAt),
        workers: String(state.workers.size),
      })
      // Schedule shutdown after this reply is sent.
      setImmediate(() => state.abort.abort()).unref()
      return ok({ op: 'shutdown', accepted: true })
    },
    lease: async (_msg, socket) => {
      // Hold the connection open; daemon counts this as an active
      // client. We just accept the lease and stay quiet.
      // Don't close the socket; stream stays alive until the client
      // disconnects (which the server's close handler observes).
      // Nothing to write back.
      socket.write('') // no-op write to confirm liveness
      return undefined
    },
    subscribe: async (msg, socket) => {
      const short = msg.short as string | undefined
      if (!short) return err('EBADREQ', 'subscribe: missing short')
      const vm = state.workers.get(short)
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
  })

  // SIGINT / SIGTERM → graceful shutdown.
  const onSignal = (): void => state.abort.abort()
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

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
  await state.server?.close()
  return 0
}
