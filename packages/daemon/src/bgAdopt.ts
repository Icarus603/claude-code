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
  readWorkerRecord,
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
export async function adoptFromRoster(
  workers: Map<string, WorkerVm>,
): Promise<void> {
  const roster = await readRoster()
  if (roster.parseFailed) return
  let adopted = 0
  let dead = 0
  for (const [short, entry] of Object.entries(roster.workers)) {
    if (workers.has(short)) continue
    if (!isPidAliveSync(entry.pid)) {
      // ant 5166.js UB8: process is gone but supervisor was down. Mark
      // the meta.json as 'failed' so `ccb ps` and the tasks panel show
      // why it ended terminally.
      markAdoptionFailed(short, 'process gone while supervisor was down')
      dead++
      continue
    }
    const ptySocket = entry.ptySock ?? entry.rendezvousSock ?? ''
    const sockExists = ptySocket ? existsSyncFn(ptySocket) : false
    if (!sockExists) {
      logEvent('tengu_bg_adopt_sock_unlinked', { short, sock: ptySocket })
      // pid alive but socket gone — worker is unreachable for attach.
      // Mark failed with the specific reason so the user understands
      // why we can't recover the session.
      markAdoptionFailed(short, 'pty socket gone — worker unreachable')
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
          status: 'failed',
          failedReason: 'process gone while supervisor was down',
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

/**
 * Mark a worker's meta.json as `status='failed'` with a human-readable
 * reason. ant 5166.js UB8 — when the supervisor adopts a roster entry
 * but discovers the underlying process / socket is gone, the user-
 * facing job state is updated so the tasks panel and `ccb ps` show
 * "why" the job ended terminally instead of leaving it as 'running'.
 *
 * No-op if the meta.json is missing (e.g. the roster carried a
 * cross-cwd entry whose jobs/ tree is on a different mount).
 */
function markAdoptionFailed(short: string, reason: string): void {
  try {
    const record = readWorkerRecord(short)
    if (!record) return
    // Don't trample a status the user already set (stopped/killed/failed).
    if (record.status !== 'running' && record.status !== 'unknown') return
    writeWorkerRecord({
      ...record,
      status: 'failed',
      failedReason: reason,
      exitedAt: Date.now(),
    })
  } catch {
    // best-effort
  }
}
