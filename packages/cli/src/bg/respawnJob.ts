/**
 * `ccb respawn <short>|--all` — restart a bg job using its original
 * directive + flags. Mirrors ant 4649.js sM3. Extracted from bg.ts to
 * keep the entry file under the 800-LOC budget.
 *
 * pty-mode + daemon alive → daemon respawn (preserves short id).
 * Otherwise: stop+rm the old job and spawn fresh; new short id issued.
 *
 * @dynamicRequire
 */

import { rmSync } from 'node:fs'

import { isProcessRunning } from './jobUtil.js'
import { extractRespawnArgs } from './respawnArgs.js'

/**
 * Minimum job-meta surface we need to respawn. Avoids importing the
 * full JobMeta type from bg.ts (which would cause a cycle).
 */
export interface RespawnJobMeta {
  short: string
  pid: number
  cmd: readonly string[]
  cwd: string
  status: string
  mode?: 'detached' | 'pty'
  ptySocket?: string
}

/**
 * Respawn a single job. Returns true on success. Cooperates with the
 * daemon (when up) to preserve short id for pty-mode workers; falls
 * back to a fresh-spawn (new short id) when daemon is unreachable or
 * the job is detached-mode.
 */
export async function respawnSingle(
  job: RespawnJobMeta,
  helpers: {
    getJobDir: (short: string) => string
    generateShortId: () => string
    spawnBgJob: (opts: {
      flags: readonly string[]
      directive: string
      cwd: string
    }) => Promise<string>
    writeJobMeta: (meta: RespawnJobMeta) => void
  },
): Promise<boolean> {
  if (job.mode === 'pty') {
    const { isDaemonAlive, daemonRespawn } = await import('./daemonAdapter.js')
    if (await isDaemonAlive()) {
      const r = await daemonRespawn(job.short)
      if (r.ok) {
        process.stdout.write(`respawned ${job.short} (same short id)\n`)
        return true
      }
      process.stderr.write(
        `daemon respawn failed (${r.code}); falling back to short-id-changing respawn\n`,
      )
    }
  }

  const args = extractRespawnArgs(job.cmd)
  if (!args) {
    process.stderr.write(`${job.short}: cannot reconstruct directive\n`)
    return false
  }
  if (job.status === 'running' && isProcessRunning(job.pid)) {
    try {
      process.kill(job.pid, 'SIGTERM')
    } catch {
      /**/
    }
  }
  rmSync(helpers.getJobDir(job.short), { recursive: true, force: true })
  try {
    let newShort: string
    if (job.mode === 'pty') {
      const { spawnPtyHost } = await import('./spawnPty.js')
      newShort = helpers.generateShortId()
      const r = spawnPtyHost({
        short: newShort,
        jobDir: helpers.getJobDir(newShort),
        ...args,
        cwd: job.cwd,
      })
      helpers.writeJobMeta({
        ...r,
        ptySocket: r.socketPath,
        status: 'running',
      })
    } else {
      newShort = await helpers.spawnBgJob({ ...args, cwd: job.cwd })
    }
    if (newShort !== job.short) {
      process.stdout.write(`(was ${job.short}, now ${newShort})\n`)
    }
    return true
  } catch (e) {
    process.stderr.write(`${job.short}: ${(e as Error).message}\n`)
    return false
  }
}
