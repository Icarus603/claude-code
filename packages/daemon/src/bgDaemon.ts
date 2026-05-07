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

import {
  type WorkerRecord,
  readAllWorkerRecords,
  writeWorkerRecord,
} from './bgWorkerRegistry.js'
import { type DaemonServer, err, ok, startSocketServer } from './socketServer.js'
import { WorkerVm } from './workerVm.js'

interface DaemonState {
  server: DaemonServer | undefined
  workers: Map<string, WorkerVm>
  abort: AbortController
  startedAt: number
}

/**
 * Boot the bg daemon. Resolves once the daemon has shut down
 * (signal or shutdown op received). Returns the daemon's exit code
 * (0 on graceful shutdown, non-zero on error).
 */
export async function bgDaemonMain(args: readonly string[]): Promise<number> {
  const _ignored = args // future: --origin, --json-path, --log-file
  const state: DaemonState = {
    server: undefined,
    workers: new Map(),
    abort: new AbortController(),
    startedAt: Date.now(),
  }

  process.title = 'ccb daemon'

  // Adopt any persisted records that look running.
  for (const record of readAllWorkerRecords()) {
    if (record.status !== 'running') continue
    if (record.mode !== 'pty') continue // only pty-mode is daemon-supervised
    const cli = record.cmd[0] ?? 'bun'
    const cwd = record.cwd
    const ptySocket = record.ptySocket ?? ''
    const vm = new WorkerVm(
      {
        short: record.short,
        cwd,
        env: process.env,
        ptySocket,
        cmd: record.cmd,
        cliVersion: process.env.CLAUDE_CODE_VERSION ?? 'dev',
      },
      record,
    )
    vm.adopt(record)
    state.workers.set(record.short, vm)
    void cli
  }

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
  await state.server?.close()
  return 0
}
