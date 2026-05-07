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

  // Daemon route (preferred for pty-mode jobs).
  if (job.mode === 'pty') {
    const { isDaemonAlive, daemonKill } = await import('./daemonAdapter.js')
    if (await isDaemonAlive()) {
      const r = await daemonKill({ short: job.short, force: opts.force })
      if (r.ok) {
        writeMeta({ status: opts.finalStatus, killedAt: Date.now() })
        process.stdout.write(`${opts.verbLabel} ${job.short} (via daemon).\n`)
        return
      }
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
    writeMeta({ status: opts.finalStatus, killedAt: Date.now() })
    process.stdout.write(
      `${opts.verbLabel} ${job.short} (pid ${job.pid}, ${signal}).\n`,
    )
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ESRCH') {
      writeMeta({ status: 'exited', exitedAt: Date.now() })
      process.stdout.write(`Job ${job.short} was already exited.\n`)
    } else {
      process.stderr.write(
        `Failed to ${opts.verbLabel.toLowerCase()} ${job.short}: ${err.message}\n`,
      )
      process.exit(1)
    }
  }
}
