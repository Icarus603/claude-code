/**
 * Shared termination worker — extracted from bg.ts for the LOC budget.
 *
 * Owns the SIGTERM/SIGKILL escalation, daemon-routing, and meta-bookkeeping
 * for `ccb stop` and `ccb kill`. Both verbs funnel through here.
 *
 * For pty-mode jobs, prefers daemon RPC (so the daemon updates its
 * in-memory state); falls back to direct pgroup kill if daemon is dead.
 *
 * @dynamicRequire
 */

export interface StopJobInput {
  short: string
  pid: number
  status: string
  mode?: 'detached' | 'pty'
  /** procStart from job meta — used by procAliveSamePid to defeat PID recycling. */
  procStart?: number
  /** When the worker started; used by emitAgentTerminal to compute duration. */
  startedAt?: number
}

export interface StopJobOpts {
  force: boolean
  verbLabel: string
  finalStatus: 'stopped' | 'killed'
}

/**
 * Kill a job. Caller provides a writeMeta callback so this module
 * doesn't need to import JobMeta type from bg.ts (cycle avoidance).
 */
export async function stopJob(
  job: StopJobInput,
  opts: StopJobOpts,
  writeMeta: (patch: { status: string; killedAt?: number; exitedAt?: number }) => void,
): Promise<void> {
  if (job.status !== 'running') {
    process.stderr.write(
      `Job ${job.short} is not running (status=${job.status}).\n`,
    )
    process.exit(0)
  }

  // Daemon route (preferred for pty-mode jobs). ant 4643.js bjH:
  // retry on ESTARTING up to 10x (200ms apart) so a worker mid-spawn
  // gets killed once it's ready instead of dropping to direct kill.
  if (job.mode === 'pty') {
    const { isDaemonAlive, daemonKill } = await import('./daemonAdapter.js')
    if (await isDaemonAlive()) {
      let r = await daemonKill({ short: job.short, force: opts.force })
      for (let i = 0; !r.ok && r.code === 'ESTARTING' && i < 10; i++) {
        await new Promise(res => setTimeout(res, 200))
        r = await daemonKill({ short: job.short, force: opts.force })
      }
      if (r.ok) {
        writeMeta({ status: opts.finalStatus, killedAt: Date.now() })
        process.stdout.write(`${opts.verbLabel} ${job.short} (via daemon).\n`)
        return
      }
      // ENOJOB / ENOCONN / ETIMEOUT → fall through to direct kill;
      // any other code is a hard daemon failure we surface but still try.
      process.stderr.write(
        `daemon kill failed (${r.code}); falling back to direct signal\n`,
      )
    }
  }

  const signal: NodeJS.Signals = opts.force ? 'SIGKILL' : 'SIGTERM'
  try {
    if (job.mode === 'pty') {
      try { process.kill(-job.pid, signal) } catch {
        process.kill(job.pid, signal)
      }
    } else {
      process.kill(job.pid, signal)
    }
    // ant 4643.js: poll procStart-verified up to 3s for graceful exit;
    // if still alive after the budget, second SIGTERM + 500ms budget.
    if (!opts.force) {
      const { procAliveSamePid } = await import('./procAlive.js')
      const deadline = Date.now() + 3000
      let alive = true
      while ((alive = procAliveSamePid(job.pid, job.procStart)) && Date.now() < deadline) {
        await new Promise(res => setTimeout(res, 100))
      }
      if (alive) {
        const { logEvent } = await import('@claude-code/local-observability')
        logEvent('tengu_bg_killjob_ctrl_fallback', { ctrlSent: 'false' })
        try {
          if (job.mode === 'pty') {
            try { process.kill(-job.pid, 'SIGTERM') } catch {
              process.kill(job.pid, 'SIGTERM')
            }
          } else {
            process.kill(job.pid, 'SIGTERM')
          }
        } catch {
          // best-effort
        }
        const fallbackDeadline = Date.now() + 500
        while ((alive = procAliveSamePid(job.pid, job.procStart)) && Date.now() < fallbackDeadline) {
          await new Promise(res => setTimeout(res, 100))
        }
      }
    }
    writeMeta({ status: opts.finalStatus, killedAt: Date.now() })
    if (job.startedAt) {
      const m = await import('./agentActionEvent.js')
      m.emitAgentTerminal(job.short, opts.finalStatus, Date.now() - job.startedAt)
    }
    process.stdout.write(
      `${opts.verbLabel} ${job.short} (pid ${job.pid}, ${signal}).\n`,
    )
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ESRCH') {
      writeMeta({ status: 'exited', exitedAt: Date.now() })
      if (job.startedAt) {
        const m = await import('./agentActionEvent.js')
        m.emitAgentTerminal(job.short, 'already_exited', Date.now() - job.startedAt)
      }
      process.stdout.write(`Job ${job.short} was already exited.\n`)
    } else {
      process.stderr.write(
        `Failed to ${opts.verbLabel.toLowerCase()} ${job.short}: ${err.message}\n`,
      )
      process.exit(1)
    }
  }
}
