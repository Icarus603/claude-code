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

import { getDefaultLauncher } from '@claude-code/repl/relaunch.js'

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
  /**
   * Mark this worker as a spare-pool member (sets CCB_SPARE=1 so the inner
   * REPL writes spare-ready.flag and skips its own state.json sync). Mirrors
   * ant's `i1O` mode param (`q === "spare"`) — an EXPLICIT mode, NOT inferred
   * from an empty directive. The left-arrow resume path also spawns with an
   * empty directive (it inherits the transcript via --resume + --fork-session
   * and must NOT re-run a prompt) yet is a real REPL, not a spare; conflating
   * the two on `directive === ''` mislabeled it as a spare. Default false.
   */
  spare?: boolean
}): SpawnPtyResult {
  mkdirSync(opts.jobDir, { recursive: true })
  const socketPath = join(opts.jobDir, 'pty.sock')

  // Outer: ccb --bg-pty-host <sock> <cols> <rows> -- <inner ccb>
  // Inner: ccb [user flags] "<directive>"  (full REPL, directive as
  // positional → Commander parses it as [prompt] which the REPL
  // pre-seeds into PromptInput on launch). Mirrors ant's behaviour:
  // the user can attach mid-conversation and continue interactively.
  //
  // Spare-pool path: caller passes directive="" to spawn a worker that
  // idles at empty prompt (waiting for a CTRL `claim` frame to inject
  // the real intent later). For that case we omit the directive arg
  // entirely so Commander doesn't see a literal "" positional (which
  // would auto-submit an empty turn). Source: ant `m_H` "spare" mode.
  const innerArgs =
    opts.directive === ''
      ? [...opts.flags]
      : [...opts.flags, opts.directive]
  // Source: ant 5286.js uKO() — `return D$() ? [process.execPath] :
  // [process.execPath, process.argv[1]]`. D$ = isBunStandalone. Both
  // `bun cli.js` and the compiled standalone binary go through one
  // codepath that prepends `[process.argv[1]]` only when NOT standalone.
  //
  // ccb previously used `process.argv0.endsWith('bun')` for this branch,
  // which BREAKS in compiled standalone binaries because Bun's compile
  // mode sets argv0='bun' (so the embedded runtime can find itself). The
  // heuristic mis-classified standalone as bun-script mode, then prepended
  // process.argv[1] (= the first user CLI flag, e.g. "who am i") in
  // front of --bg-pty-host. The spawn line ended up looking like
  // `bun --bg-pty-host …` which, when resolved through PATH, found the
  // user's local bun and tried to load "--bg-pty-host" as a script — exit
  // immediately, pty.sock never appears, fleetAttach polls 10s, and the
  // user's right-arrow keystrokes leak into the terminal as ^[[C because
  // stdin raw mode was already released during ink unmount.
  //
  // getDefaultLauncher({pinToCurrentBinary:true}) is ccb's `Pb` —
  // mirrors ant 5286.js uKO + 4835.js `Pb({pinToCurrentBinary:!0})`.
  // pinToCurrentBinary skips the auto-update symlink redirect: the bg
  // worker must boot the SAME binary that spawned it, otherwise an
  // auto-update mid-spawn would race the worker against a different
  // version's wire protocol.
  const launcher = getDefaultLauncher({ pinToCurrentBinary: true })
  const cmd = launcher.cmd
  const prefixArgs = launcher.prefixArgs
  const cols = String(process.stdout.columns || 200)
  const rows = String(process.stdout.rows || 50)
  const hostArgs = [
    ...prefixArgs,
    '--bg-pty-host',
    socketPath,
    cols,
    rows,
    '--',
    cmd,
    ...prefixArgs,
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
    // Spare-pool marker: an EXPLICIT spare flag (ant `i1O` mode "spare"),
    // not inferred from an empty directive. Read by useSpareReadyMarker
    // (writes spare-ready.flag) + useBgFleetStateSync (skips its own
    // state.json sync — we don't want the worker writing `state: 'working'`
    // while it's actually idle waiting). Source: ant 4774.js spare workers
    // run with `m_H(..., "spare", ...)`. The left-arrow resume path also
    // spawns directive='' but is a real REPL, so it must stay UNmarked.
    ...(opts.spare === true ? { CCB_SPARE: '1' } : {}),
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
