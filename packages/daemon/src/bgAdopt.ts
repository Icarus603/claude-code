/**
 * BG-daemon adoption sweeps. ant 5166.js mxb (roster path) + 4639.js (jobs/
 * scan path). Extracted from bgDaemon.ts to keep the entry file under the
 * 800-LOC budget; behavior is identical, the helpers just take the workers
 * map + the daemon's process env explicitly instead of capturing them via
 * closure.
 *
 * @dynamicRequire
 */

import { existsSync as existsSyncFn } from 'node:fs'

import { logEvent } from '@claude-code/local-observability'

import {
  type WorkerRecord,
  isPidAlive as isPidAliveSync,
  readAllWorkerRecords,
  writeWorkerRecord,
} from './bgWorkerRegistry.js'
import { readRoster } from './roster.js'
import { WorkerVm } from './workerVm.js'

/**
 * Boot adopt from roster.json. Supervisor loads the previous roster,
 * replays each entry as an adoption attempt (verifying pid + socket
 * exists), and orphans entries whose underlying process is gone.
 *
 * Roster mode adoptions take precedence over the jobs/ scan because the
 * roster carries cross-cwd entries the cwd-scoped jobs/ tree wouldn't
 * see. On parseFailed roster, we skip — the file has been quarantined
 * and we'll fall through to jobs/ scan + write a fresh empty roster.
 */
export function adoptFromRoster(workers: Map<string, WorkerVm>): void {
  const roster = readRoster()
  if (roster.parseFailed) return
  let adopted = 0
  let dead = 0
  for (const [short, entry] of Object.entries(roster.workers)) {
    if (workers.has(short)) continue
    if (!isPidAliveSync(entry.pid)) {
      dead++
      continue
    }
    const ptySocket = entry.ptySock ?? entry.rendezvousSock ?? ''
    const sockExists = ptySocket ? existsSyncFn(ptySocket) : false
    if (!sockExists) {
      logEvent('tengu_bg_adopt_sock_unlinked', { short, sock: ptySocket })
      dead++
      continue
    }
    const record: WorkerRecord = {
      short,
      pid: entry.pid,
      cmd: [],
      cwd: entry.cwd,
      startedAt: entry.startedAt,
      status: 'running',
      mode: 'pty',
      ptySocket,
      procStart: entry.procStart,
      attempt: entry.attempt,
      cliVersion: entry.cliVersion,
    }
    const vm = new WorkerVm(
      {
        short,
        cwd: entry.cwd,
        env: process.env,
        ptySocket,
        cmd: [],
        cliVersion: process.env.CLAUDE_CODE_VERSION ?? 'dev',
      },
      record,
    )
    vm.adopt(record)
    workers.set(short, vm)
    adopted++
  }
  if (adopted + dead > 0) {
    logEvent('tengu_bg_adopt', {
      adopted: String(adopted),
      dead: String(dead),
      source: 'roster',
    })
  }
}

/**
 * Periodic scan of jobs/<short>/meta.json for workers spawned outside
 * our spawn op (e.g. ccb --bg-pty fired by user). Adopts each running
 * pty record; reaps orphans whose pid is gone.
 */
export function adoptRunningPtyRecords(workers: Map<string, WorkerVm>): void {
  for (const record of readAllWorkerRecords()) {
    if (record.status !== 'running') continue
    if (record.mode !== 'pty') continue
    if (workers.has(record.short)) continue
    if (!isPidAliveSync(record.pid)) {
      logEvent('tengu_bg_orphan_reap', {
        short: record.short,
        pid: String(record.pid),
      })
      try {
        writeWorkerRecord({
          ...record,
          status: 'exited',
          exitedAt: Date.now(),
        })
      } catch {
        // best-effort
      }
      continue
    }
    const ptySocket = record.ptySocket ?? ''
    const sockExists = ptySocket ? existsSyncFn(ptySocket) : false
    if (ptySocket && !sockExists) {
      logEvent('tengu_bg_adopt_sock_unlinked', {
        short: record.short,
        sock: ptySocket,
      })
    }
    const currentCli = process.env.CLAUDE_CODE_VERSION ?? 'dev'
    if (record.cliVersion && record.cliVersion !== currentCli) {
      logEvent('tengu_bg_adopt_upgrade_respawn', {
        short: record.short,
        was: record.cliVersion,
        now: currentCli,
      })
    }
    if (record.procStart === undefined || record.procStart === 0) {
      logEvent('tengu_bg_adopt_unverified', {
        short: record.short,
        pid: String(record.pid),
      })
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
    workers.set(record.short, vm)
    logEvent('tengu_bg_adopt', {
      short: record.short,
      pid: String(record.pid),
      sock_exists: String(sockExists),
      verified: String(record.procStart !== undefined && record.procStart !== 0),
    })
  }
}
