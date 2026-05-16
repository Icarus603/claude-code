/**
 * Right-arrow on a job → launch ccb REPL. No checks, no fallbacks,
 * no clever pause-and-restore dance. Just spawn ccb in the job's cwd
 * with stdio:inherit. When the user exits ccb, control returns to
 * the FleetView loop.
 *
 * Yes the child takes ~1s to boot. There's no way around that without
 * keeping a long-lived child process alive (which is what a daemon
 * does and what ant relies on). This is the simplest implementation
 * that actually works for any session, live or dead.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function getJobsRoot(): string {
  const root = process.env.CLAUDE_CONFIG_HOME
  return root ? join(root, 'jobs') : join(homedir(), '.claude', 'jobs')
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

interface FleetState {
  cwd?: string
  respawnFlags?: readonly string[]
}

function readFleetState(short: string): FleetState | null {
  const path = join(getJobsRoot(), short, 'state.json')
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
  const state = readFleetState(short)
  const cwd = state?.cwd ?? process.cwd()
  const flags = state?.respawnFlags ?? []

  const { instances } = await import('@anthropic/ink')
  const ink = instances.get(process.stdout)

  ink?.pause()
  ink?.suspendStdin()
  try {
    const { cmd, args } = buildCcbArgv([...flags])
    spawnSync(cmd, args, { cwd, stdio: 'inherit' })
  } finally {
    ink?.repaint()
    ink?.resumeStdin()
    ink?.resume()
  }
}
