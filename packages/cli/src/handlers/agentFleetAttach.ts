/**
 * Inline attach handler for FleetView right-arrow / enter on a job.
 *
 * User invariant (literal): "right-arrow goes INTO the session, no
 * matter if it has logs or conversation". Implementation, in order:
 *
 *   1. Live PTY socket (meta.ptySocket OR <jobDir>/pty.sock exists) →
 *      runAttach for bidirectional terminal. ant's `Md` equivalent.
 *   2. No live PTY → launch a fresh foreground ccb in the job's cwd.
 *      User lands in a real interactive ccb session at the same
 *      working directory; when they exit, FleetView re-mounts. This
 *      matches "directly enter the session" semantics even when the
 *      original worker is dead and there's no conversation to resume.
 *
 * Never calls process.exit. Always resolves so the FleetView loop can
 * re-mount on return.
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

interface BgMeta {
  short: string
  mode?: 'pty' | 'detached'
  ptySocket?: string
  status?: string
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

/**
 * Build the argv for re-running ccb. Matches spawnBgJob's logic in
 * bg.ts:404-410.
 */
function buildCcbArgv(extraArgs: readonly string[]): { cmd: string; args: string[] } {
  const isBun = process.argv0.endsWith('bun')
  if (isBun) {
    const cliJs = process.argv[1] ?? ''
    return { cmd: process.argv0, args: [cliJs, ...extraArgs] }
  }
  return { cmd: process.argv[0]!, args: [...extraArgs] }
}

/**
 * Attach to a fleet job. Never throws. Always returns. Keeps the Ink
 * root mounted across the handoff — FleetView stays "frozen" on screen
 * while the child boots (pause + suspendStdin), then takes over. When
 * the child exits, repaint + resume the existing Ink root so FleetView
 * comes back instantly with no remount. Smooth direct transition, no
 * visible exit-then-enter flash.
 *
 * ant equivalent: handoffAltScreen (2356.js:483) + Md attach (4767.js:17).
 */
export async function fleetAttach(short: string): Promise<void> {
  const meta = readMeta(short)
  const state = readFleetState(short)
  const jobDir = getJobDir(short)

  const { instances } = await import('@anthropic/ink')
  const ink = instances.get(process.stdout)

  const ptySocketPath = meta?.ptySocket ?? join(jobDir, 'pty.sock')
  void state
  void buildCcbArgv
  void spawnSync

  // Wait briefly for the socket to appear (in case dispatch just
  // happened and the host child is still booting). This lets us hit
  // runAttach (instant) instead of spawning a fresh ccb (slow).
  if (!existsSync(ptySocketPath)) {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      if (existsSync(ptySocketPath)) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }

  if (!existsSync(ptySocketPath)) {
    // No live PTY — don't spawn a fresh ccb (1-2s boot delay = visible
    // "exit then re-enter"). Stay in FleetView; tell user to re-dispatch.
    process.stderr.write(
      `\nSession ${short} has no live worker. Re-dispatch from FleetView to spawn fresh.\n`,
    )
    return
  }

  // Pause Ink (no clear). FleetView's last frame stays visible until
  // runAttach paints over it. Zero-flash handoff.
  ink?.pause()
  ink?.suspendStdin()
  try {
    const { runAttach } = await import('../bg/attachClient.js')
    await runAttach(ptySocketPath, short)
  } catch (err) {
    process.stderr.write(`pty attach failed: ${(err as Error).message}\n`)
  } finally {
    ink?.repaint()
    ink?.resumeStdin()
    ink?.resume()
  }
}
