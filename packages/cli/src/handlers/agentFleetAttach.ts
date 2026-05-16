/**
 * Inline attach handler for FleetView right-arrow / enter on a job.
 *
 * User intent: pressing right-arrow on a session MUST drop the user
 * INTO that session as a real interactive Claude Code REPL — not show
 * logs, not exit with a hint. This module spawns `ccb --resume
 * <sessionId>` as a foreground child with inherited stdio, blocks
 * until the child exits, then returns control to the FleetView loop.
 *
 * Fallbacks (in order):
 *   1. state.json present + sessionId set → `ccb --resume <sessionId>`
 *      (the real REPL with full history).
 *   2. meta.json present + PTY mode + running → bidirectional PTY attach
 *      (sessions spawned with --bg-pty).
 *   3. detached mode → stream stdout.log + stderr.log (read-only logs).
 *   4. No log files at all → friendly message + wait for any key.
 *
 * Never calls process.exit. Always resolves so the FleetView loop can
 * re-mount on return.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import chalk from 'chalk'

const POLL_MS = 200

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
  pid?: number
}

interface FleetState {
  sessionId?: string
  resumeSessionId?: string
}

function readMeta(short: string): BgMeta | null {
  const path = join(getJobDir(short), 'meta.json')
  if (!existsSync(path)) return null
  try {
    const buf = readWholeFile(path)
    return JSON.parse(buf) as BgMeta
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
 * Build the argv for re-running ccb with the given flags. Matches
 * spawnBgJob's logic in bg.ts:404-410 — uses argv0+argv[1] under Bun
 * (need to keep the .js path), argv[0] directly for the standalone
 * binary.
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
 * Run `ccb --resume <sessionId>` as a foreground subprocess inheriting
 * the terminal stdio. Returns when the child exits.
 */
function resumeSessionInline(sessionId: string): void {
  const { cmd, args } = buildCcbArgv(['--resume', sessionId])
  spawnSync(cmd, args, { stdio: 'inherit' })
}

/**
 * Attach to a fleet job. Returns when the user detaches. Never throws
 * or calls process.exit.
 *
 * Resolution order:
 *   1. state.json sessionId → spawn `ccb --resume <sessionId>` with
 *      inherited stdio. This is the REAL session REPL — the user lands
 *      in a fully interactive Claude Code session with the bg job's
 *      conversation history loaded.
 *   2. meta.json + PTY mode → bidirectional PTY attach via runAttach.
 *   3. fallback → stream stdout.log / stderr.log.
 */
export async function fleetAttach(short: string): Promise<void> {
  const state = readFleetState(short)
  const meta = readMeta(short)
  const jobDir = getJobDir(short)

  // Primary path: resume the actual REPL session (ant equivalent).
  const sessionId = state?.sessionId ?? state?.resumeSessionId
  if (sessionId !== undefined && sessionId !== '') {
    resumeSessionInline(sessionId)
    return
  }

  // Fallback: PTY-mode attach (sessions spawned with --bg-pty).
  if (meta?.mode === 'pty' && meta.ptySocket !== undefined && meta.status === 'running') {
    try {
      const { runAttach } = await import('../bg/attachClient.js')
      await runAttach(meta.ptySocket, short)
      return
    } catch (err) {
      process.stderr.write(`pty attach failed: ${(err as Error).message}\n`)
      // Fall through to log streaming.
    }
  }

  // Detached / no-meta → stream stdout.log + stderr.log.
  const stdoutPath = join(jobDir, 'stdout.log')
  const stderrPath = join(jobDir, 'stderr.log')
  const hasStdout = existsSync(stdoutPath)
  const hasStderr = existsSync(stderrPath)

  if (!hasStdout && !hasStderr) {
    process.stdout.write(
      chalk.dim(
        `\n  ${chalk.cyan(short)}: no log files yet — session may not have started writing output.\n  Press Enter or wait, then re-open with right-arrow.\n\n`,
      ),
    )
    await waitForEnterOrCtrlC()
    return
  }

  process.stdout.write(
    chalk.dim(`\n  attached to ${chalk.cyan(short)} — Ctrl+C to detach\n\n`),
  )

  // Stream both files via polling tail.
  const cleanups: Array<() => void> = []
  let stdoutPos = 0
  let stderrPos = 0

  const pumpFile = (
    path: string,
    lastPos: number,
    sink: NodeJS.WriteStream,
  ): number => {
    try {
      if (!existsSync(path)) return lastPos
      const stat = statSync(path)
      if (stat.size <= lastPos) return lastPos
      const fd = openSync(path, 'r')
      try {
        const buf = Buffer.alloc(stat.size - lastPos)
        readSync(fd, buf, 0, buf.length, lastPos)
        sink.write(buf.toString('utf8'))
        return stat.size
      } finally {
        closeSync(fd)
      }
    } catch {
      return lastPos
    }
  }

  // Initial dump.
  if (hasStdout) stdoutPos = pumpFile(stdoutPath, 0, process.stdout)
  if (hasStderr) stderrPos = pumpFile(stderrPath, 0, process.stderr)

  const handle = setInterval(() => {
    if (hasStdout) stdoutPos = pumpFile(stdoutPath, stdoutPos, process.stdout)
    if (hasStderr) stderrPos = pumpFile(stderrPath, stderrPos, process.stderr)
  }, POLL_MS)
  cleanups.push(() => clearInterval(handle))

  try {
    await waitForCtrlC()
  } finally {
    for (const c of cleanups) c()
  }
}

/** Block until user presses Ctrl+C; resolve on key without exiting process. */
function waitForCtrlC(): Promise<void> {
  return new Promise(resolve => {
    if (!process.stdin.isTTY) {
      resolve()
      return
    }
    const wasRaw = process.stdin.isRaw
    process.stdin.setRawMode?.(true)
    process.stdin.resume()
    const onData = (chunk: Buffer): void => {
      // Ctrl+C = 0x03, Ctrl+Q = 0x11, ESC = 0x1b, q = 0x71
      for (const b of chunk) {
        if (b === 0x03 || b === 0x11 || b === 0x1b || b === 0x71) {
          process.stdin.off('data', onData)
          process.stdin.setRawMode?.(wasRaw)
          process.stdin.pause()
          resolve()
          return
        }
      }
    }
    process.stdin.on('data', onData)
  })
}

/** Like waitForCtrlC but also resolves on Enter — for the no-logs-yet case. */
function waitForEnterOrCtrlC(): Promise<void> {
  return new Promise(resolve => {
    if (!process.stdin.isTTY) {
      resolve()
      return
    }
    const wasRaw = process.stdin.isRaw
    process.stdin.setRawMode?.(true)
    process.stdin.resume()
    const onData = (chunk: Buffer): void => {
      for (const b of chunk) {
        if (b === 0x03 || b === 0x11 || b === 0x1b || b === 0x71 || b === 0x0d) {
          process.stdin.off('data', onData)
          process.stdin.setRawMode?.(wasRaw)
          process.stdin.pause()
          resolve()
          return
        }
      }
    }
    process.stdin.on('data', onData)
  })
}
