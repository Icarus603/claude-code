/**
 * fleetAttach — runs the attach handoff between two FleetView mounts.
 *
 * Source: ant 5092.js Ot3 attach branch — after FleetView resolves with
 * action="open" and the root is unmounted, ant calls `ZvK(short, {alreadyInAlt})`
 * which is the attach core (ant 4767.js Md client equivalent of ccb's runAttach).
 *
 * Two paths in ccb:
 *   1. Live PTY socket (meta.ptySocket or <jobDir>/pty.sock exists):
 *      runAttach connects to it. Instant — Unix socket connect + first
 *      PTY frame is sub-100ms. Used for sessions freshly dispatched
 *      via spawnBgPty.
 *   2. No live PTY (old / orphaned sessions): spawn a fresh ccb REPL
 *      in the job's cwd via spawnSync(stdio:'inherit'). Boot delay is
 *      ~1-2s (Bun + ccb bundle).
 *
 * NOTE: pause/suspendStdin/resume is gone — the caller (agentsFleet.ts
 * loop) unmounts the FleetView Ink root BEFORE calling this and mounts
 * a fresh one AFTER. That gives the inner REPL a clean terminal and
 * avoids the frame-buffer drift that broke the return-to-FleetView path.
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

  const ptySocketPath = meta?.ptySocket ?? join(jobDir, 'pty.sock')
  const hasLivePty = existsSync(ptySocketPath)

  if (hasLivePty) {
    try {
      const { runAttach } = await import('../bg/attachClient.js')
      await runAttach(ptySocketPath, short)
      return
    } catch (err) {
      process.stderr.write(`pty attach failed: ${(err as Error).message}\n`)
      // Fall through to spawnSync path.
    }
  }

  // SLOW path — no live PTY worker. Spawn a fresh ccb REPL inheriting
  // the user's TTY. CCB_FLEET_ATTACH_CHILD lets the child REPL detect
  // it's a FleetView attach handoff (left-arrow on empty exits cleanly).
  const cwd = state?.cwd ?? process.cwd()
  const flags = state?.respawnFlags ?? []
  const { cmd, args } = buildCcbArgv([...flags])
  spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, CCB_FLEET_ATTACH_CHILD: '1' },
  })
}
