/**
 * Spawn a PTY-mode bg job. Phase C variant of `spawnBgJob`:
 * instead of detaching with stdio→file, we fork ourselves with
 * `--bg-pty-host <sock> <cols> <rows> -- <ccb-cmd>`. The host process
 * opens a Bun.Terminal, runs the inner ccb in it, and exposes the
 * PTY over a Unix socket. `ccb attach <short>` later connects to
 * that socket via the adopter for true bidirectional UX.
 *
 * Extracted from bg.ts to keep that file under the LOC budget.
 *
 * @dynamicRequire
 */

import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import chalk from 'chalk'

export interface SpawnPtyResult {
  short: string
  pid: number
  cmd: readonly string[]
  cwd: string
  startedAt: number
  socketPath: string
  /** Always 'pty'. Set as meta.mode by the caller. */
  mode: 'pty'
  /** procStart timestamp; defeats PID recycle. Read sync at spawn time. */
  procStart?: number
  /** ccb version that spawned the worker. */
  cliVersion?: string
}

/**
 * Build the spawn command + env, fork the PTY-host child, and return
 * the metadata the caller persists into meta.json. Caller owns the
 * meta.json write to avoid leaking JobMeta type into this file.
 */
export function spawnPtyHost(opts: {
  short: string
  jobDir: string
  flags: readonly string[]
  directive: string
  cwd: string
  /** Suppress the "backgrounded (pty)" stdout banner. Used by FleetView
   *  dispatch — the new job is surfaced via state.json polling, not
   *  by writing to the terminal (which would corrupt the TUI). */
  quiet?: boolean
}): SpawnPtyResult {
  mkdirSync(opts.jobDir, { recursive: true })
  const socketPath = join(opts.jobDir, 'pty.sock')

  // Outer: ccb --bg-pty-host <sock> <cols> <rows> -- <inner ccb>
  // Inner: ccb [user flags] "<directive>"  (full REPL, directive as
  // positional → Commander parses it as [prompt] which the REPL
  // pre-seeds into PromptInput on launch). Mirrors ant's behaviour:
  // the user can attach mid-conversation and continue interactively.
  const innerArgs = [...opts.flags, opts.directive]
  const isBun = process.argv0.endsWith('bun')
  const cmd = isBun ? process.argv0 : process.argv[0]!
  const cliJs = isBun ? [process.argv[1] ?? ''] : []
  const cols = String(process.stdout.columns || 200)
  const rows = String(process.stdout.rows || 50)
  const hostArgs = [
    ...cliJs,
    '--bg-pty-host',
    socketPath,
    cols,
    rows,
    '--',
    cmd,
    ...cliJs,
    ...innerArgs,
  ]
  const fullCmd = [cmd, ...hostArgs]

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CODE_SESSION_KIND: 'bg',
    CLAUDE_CODE_BG_JOB_SHORT: opts.short,
    FORCE_COLOR: '3',
    COLORTERM: 'truecolor',
    BROWSER: 'true',
    CLAUDE_JOB_DIR: opts.jobDir,
    CLAUDE_BG_BACKEND: 'pty',
    CLAUDE_BG_SOURCE: 'cli',
    CLAUDE_ENABLE_STREAM_WATCHDOG: '1',
    CLAUDE_CODE_SESSION_NAME: opts.short,
  }

  const child = spawn(cmd, hostArgs, {
    cwd: opts.cwd,
    env,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  child.unref()

  if (child.pid === undefined) {
    rmSync(opts.jobDir, { recursive: true, force: true })
    process.stderr.write(`Failed to spawn pty-host: ${fullCmd.join(' ')}\n`)
    process.exit(1)
  }

  // Pretty hint output: cyan short, dim hints (ant 4649.js tw6).
  // Suppressed when called from FleetView (TUI owns the screen).
  if (opts.quiet !== true) {
    const d = (l: string, r: string) => chalk.dim(`  ${l.padEnd(26)}${r}`)
    process.stdout.write(
      [
        `backgrounded (pty) · ${chalk.cyan(opts.short)}`,
        d(`ccb attach ${opts.short}`, 'open in this terminal (bidirectional)'),
        d(`ccb stop ${opts.short}`, 'stop this session (SIGTERM)'),
        d(`ccb rm   ${opts.short}`, 'remove the job directory'),
        '',
      ].join('\n'),
    )
  }

  // readProcStart is sync (reads /proc or runs ps); cheap enough at spawn time.
  // Imported lazily to avoid pulling daemon package into a path this file
  // could be called from without daemon present.
  const { readProcStart } = require('@claude-code/daemon/bgWorkerRegistry.js') as typeof import('@claude-code/daemon/bgWorkerRegistry.js')
  return {
    short: opts.short,
    pid: child.pid,
    cmd: fullCmd,
    cwd: opts.cwd,
    startedAt: Date.now(),
    socketPath,
    mode: 'pty',
    procStart: readProcStart(child.pid) || undefined,
    cliVersion: MACRO.VERSION,
  }
}
