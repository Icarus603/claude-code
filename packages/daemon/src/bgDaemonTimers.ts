/**
 * Bg-daemon idle-exit + binary-upgrade watchdog timers. Extracted from
 * bgDaemon.ts so the entry file stays under the 800-LOC budget. ant
 * 5170.js iFK:172-244 — these run for the lifetime of the daemon and
 * abort the AbortController when their condition fires.
 *
 * @dynamicRequire
 */

import { statSync } from 'node:fs'

import { logEvent } from '@claude-code/local-observability'

import type { WorkerVm } from './workerVm.js'

/**
 * idleActivityCount counts everything that pins the supervisor —
 * leases (active client connections), live workers, and detached
 * workers (still running but no longer supervised). Zero means the
 * daemon is idle and a transient origin can self-shutdown.
 */
export function makeIdleActivityCount(state: {
  leases: { readonly size: number }
  workers: { readonly size: number }
  detached: { readonly size: number }
}): () => number {
  return () => state.leases.size + state.workers.size + state.detached.size
}

export interface IdleExitOptions {
  origin: string
  abort: AbortController
  graceMs: number
  countActivity: () => number
}

/**
 * Set up the idle-exit watchdog. Returns a probe-tick callback caller
 * should fire every ~2s + a clear function to teardown. When the
 * activity count is 0 for `graceMs`, emits tengu_daemon_idle_exit and
 * aborts the controller (graceful shutdown).
 *
 * Service/shell origins pin the supervisor — they never idle-exit.
 */
export function setupIdleExitWatchdog(opts: IdleExitOptions): {
  probe: () => void
  dispose: () => void
} {
  let idleExitTimer: NodeJS.Timeout | null = null
  const probe = (): void => {
    if (opts.origin !== 'transient') return
    if (opts.abort.signal.aborted) return
    if (opts.countActivity() > 0) {
      if (idleExitTimer) {
        clearTimeout(idleExitTimer)
        idleExitTimer = null
      }
      return
    }
    if (idleExitTimer) return
    idleExitTimer = setTimeout(() => {
      idleExitTimer = null
      if (opts.abort.signal.aborted) return
      if (opts.countActivity() > 0) return
      logEvent('tengu_daemon_idle_exit', {
        grace_ms: String(opts.graceMs),
        cfg_workers: '0',
      })
      opts.abort.abort()
    }, opts.graceMs)
    idleExitTimer.unref()
  }
  return {
    probe,
    dispose() {
      if (idleExitTimer) {
        clearTimeout(idleExitTimer)
        idleExitTimer = null
      }
    },
  }
}

/**
 * Set up the binary-upgrade watchdog. Watches argv[1] (the ccb binary)
 * for mtime change; on detection, emits tengu_daemon_self_restart_on_upgrade
 * and aborts the controller so the wrapper / launchAgent restarts the
 * supervisor under the new binary. Bg workers are re-adopted from the
 * roster on the next supervisor's boot.
 *
 * Returns initial mtime + dispose function. If argv[1] is unreadable
 * (which happens on some compiled-bundle paths), returns initialMtime=null
 * and the probe is a no-op.
 */
export function setupUpgradeWatchdog(
  abort: AbortController,
): { dispose: () => void } {
  const binaryPath = process.argv[1] ?? process.execPath
  let initialMtime: number | null = null
  try {
    initialMtime = statSync(binaryPath).mtimeMs
  } catch {
    return { dispose: () => {} }
  }
  const timer = setInterval(() => {
    if (initialMtime === null) return
    if (abort.signal.aborted) return
    try {
      const current = statSync(binaryPath).mtimeMs
      if (current !== initialMtime) {
        logEvent('tengu_daemon_self_restart_on_upgrade', {
          old_mtime: String(initialMtime),
          new_mtime: String(current),
        })
        abort.abort()
      }
    } catch {
      // best-effort
    }
  }, 30_000)
  timer.unref()
  return {
    dispose() {
      clearInterval(timer)
    },
  }
}

/**
 * Worker map type for makeIdleActivityCount — exported so callers can
 * type-narrow without pulling WorkerVm into bgDaemonTimers.
 */
export type WorkerMaps = {
  workers: Map<string, WorkerVm>
  detached: Map<string, WorkerVm>
  leases: Set<unknown>
}
