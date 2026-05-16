/**
 * Inline attach handler for FleetView right-arrow / enter on a job.
 *
 * Unlike `bg.ts:attachHandler` which calls `process.exit(1)` on lookup
 * failure (would kill the FleetView loop), this is a graceful version
 * that:
 *
 *   1. Resolves the job via meta.json if present
 *   2. Falls through to streaming stdout.log directly if meta.json is
 *      missing but state.json (FleetView's storage) shows the row
 *   3. Returns cleanly when the user presses Ctrl+C / Ctrl+Q so the
 *      caller can re-mount FleetView
 *
 * In PTY mode (worker spawned with `--bg-pty`), uses ccb's `runAttach`
 * for bidirectional terminal; otherwise streams stdout+stderr from the
 * job directory.
 */

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
 * Attach to a fleet job. Returns when the user detaches (Ctrl+Q in PTY,
 * Ctrl+C in streaming). Never throws or calls process.exit.
 */
export async function fleetAttach(short: string): Promise<void> {
  const meta = readMeta(short)
  const jobDir = getJobDir(short)

  // PTY mode + meta present → bidirectional attach via ccb's existing client.
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
