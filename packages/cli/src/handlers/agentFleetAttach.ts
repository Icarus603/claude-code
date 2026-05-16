/**
 * fleetAttach — right-arrow on a session row.
 *
 * Two paths:
 *   1. Live PTY socket (meta.ptySocket or <jobDir>/pty.sock exists):
 *      runAttach connects to it. Instant — Unix socket connect + first
 *      PTY frame is sub-100ms. Used for sessions freshly dispatched
 *      via spawnBgPty.
 *   2. No live PTY (e.g. old daemon-managed sessions inherited from
 *      ant): spawn a fresh ccb REPL in the job's cwd. Boot delay is
 *      ~1-2s (Bun + ccb bundle). User accepts this for "ghost"
 *      sessions that have no running worker process.
 *
 * Both paths use Ink's pause + suspendStdin so FleetView's last frame
 * stays visible during the handoff (no main-screen scrollback flash).
 */

import { spawnSync } from 'node:child_process'
import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function getJobsRoot(): string {
  const root = process.env.CLAUDE_CONFIG_HOME
  return root ? join(root, 'jobs') : join(homedir(), '.claude', 'jobs')
}

function getJobDir(short: string): string {
  return join(getJobsRoot(), short)
}

function readWholeFile(path: string): string {
  const stat = statSync(path)
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(stat.size)
    readSync(fd, buf, 0, buf.length, 0)
    return buf.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

interface BgMeta {
  ptySocket?: string
}

interface FleetState {
  cwd?: string
  respawnFlags?: readonly string[]
}

function readMeta(short: string): BgMeta | null {
  const path = join(getJobDir(short), 'meta.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readWholeFile(path)) as BgMeta
  } catch {
    return null
  }
}

function readFleetState(short: string): FleetState | null {
  const path = join(getJobDir(short), 'state.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readWholeFile(path)) as FleetState
  } catch {
    return null
  }
}

function buildCcbArgv(extraArgs: readonly string[]): { cmd: string; args: string[] } {
  const isBun = process.argv0.endsWith('bun')
  if (isBun) {
    const cliJs = process.argv[1] ?? ''
    return { cmd: process.argv0, args: [cliJs, ...extraArgs] }
  }
  return { cmd: process.argv[0]!, args: [...extraArgs] }
}

export async function fleetAttach(short: string): Promise<void> {
  const meta = readMeta(short)
  const state = readFleetState(short)
  const jobDir = getJobDir(short)

  const { instances } = await import('@anthropic/ink')
  const ink = instances.get(process.stdout)

  const ptySocketPath = meta?.ptySocket ?? join(jobDir, 'pty.sock')
  const hasLivePty = existsSync(ptySocketPath)

  ink?.pause()
  ink?.suspendStdin()
  try {
    if (hasLivePty) {
      // INSTANT path — Unix socket connect + first frame in <100ms.
      try {
        const { runAttach } = await import('../bg/attachClient.js')
        await runAttach(ptySocketPath, short)
        return
      } catch (err) {
        process.stderr.write(`pty attach failed: ${(err as Error).message}\n`)
        // Fall through.
      }
    }

    // SLOW path — fresh ccb boot. ~1-2s of "starting" delay. Only hit
    // for sessions without a running PTY worker (old / orphan).
    const cwd = state?.cwd ?? process.cwd()
    const flags = state?.respawnFlags ?? []
    const { cmd, args } = buildCcbArgv([...flags])
    spawnSync(cmd, args, { cwd, stdio: 'inherit' })
  } finally {
    ink?.repaint()
    ink?.resumeStdin()
    ink?.resume()
  }
}
