/**
 * OS-level background sessions for ccb. Mirrors the user-facing surface
 * of ant v2.1.131 4649.js (NJK) — daemon-less Phase B implementation.
 *
 * ant runs a long-lived daemon supervising jobs over a Unix socket;
 * ccb instead uses `spawn(detached:true) + unref() + stdio→file`, and
 * the verb commands (ps/logs/stop/etc.) read `~/.claude/jobs/<short>/`
 * directly. Daemon-managed PTY-attach is Phase C — the on-disk layout
 * here is forward-compatible.
 *
 * Subcommand surface (verb names mirror ant for muscle memory):
 *   --bg "<directive>"        spawn a backgrounded -p run
 *   ps                        list active + recent sessions
 *   logs <short>              tail stdout/stderr (-f follow, --tail N)
 *   stop <short>              SIGTERM; --force / kill aliases SIGKILL
 *   attach <short>            alias for `logs --follow` (no PTY)
 *   rm <short>                remove a stopped job's dir
 *   respawn <short>|--all     re-launch with same directive + flags
 */

import { spawn, type SpawnOptions } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import chalk from 'chalk'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  hasAutoModeOptIn,
  hasSkipDangerousModePermissionPrompt,
} from '@claude-code/config/settings'
import { splitBgArgs } from './bg/argParse.js'
import {
  formatRelativeTime,
  isProcessRunning,
  truncate,
} from './bg/jobUtil.js'
import { extractRespawnArgs } from './bg/respawnArgs.js'
import { tailFile } from './bg/tailFile.js'

interface JobMeta {
  short: string
  pid: number
  cmd: readonly string[]
  cwd: string
  startedAt: number
  /**
   * Last observed status. Updated by ps when reconciling against the
   * live PID list. The on-disk value is authoritative when the process
   * isn't running anymore (running → exited transition is recorded
   * lazily — there's no daemon watching).
   *
   * `stopped` = graceful SIGTERM via `ccb stop`. `killed` = SIGKILL via
   * `ccb stop --force` / `ccb kill`. `exited` = natural termination.
   */
  status: 'running' | 'exited' | 'stopped' | 'killed' | 'unknown'
  /** Set when `ccb stop`/`ccb kill` runs. Distinct from natural exit. */
  killedAt?: number
  /** Set the first time ps reconciles `running → exited`. */
  exitedAt?: number
  exitCode?: number
  /**
   * Spawn mode. 'detached' = traditional `-p` headless run (default).
   * 'pty' = `--bg-pty-host` interactive REPL inside a PTY socket.
   * Undefined defaults to 'detached' for backward compat with meta.json
   * files written before Phase C landed.
   */
  mode?: 'detached' | 'pty'
  /** Path to the PTY host's Unix socket. Set iff mode==='pty'. */
  ptySocket?: string
  /** procStart timestamp from /proc or ps; defeats PID-recycle false alives. */
  procStart?: number
  /** ccb version that spawned this worker; daemon adopt compares for upgrade. */
  cliVersion?: string
  /** Count of attach-stall-triggered respawns. ant 5164.js wF3. */
  attachStallRespawns?: number
}

const JOB_SHORT_LENGTH = 8

function getJobsRoot(): string {
  // CLAUDE_CONFIG_HOME env override mirrors the rest of the CLI's
  // config-dir convention; default to ~/.claude.
  const root = process.env.CLAUDE_CONFIG_HOME
  return root ? resolve(root, 'jobs') : join(homedir(), '.claude', 'jobs')
}

function ensureJobsRoot(): string {
  const root = getJobsRoot()
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

function generateShortId(): string {
  return randomBytes(Math.ceil(JOB_SHORT_LENGTH / 2))
    .toString('hex')
    .slice(0, JOB_SHORT_LENGTH)
}

function getJobDir(short: string): string {
  return join(getJobsRoot(), short)
}

function readJobMeta(short: string): JobMeta | null {
  const path = join(getJobDir(short), 'meta.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as JobMeta
  } catch {
    return null
  }
}

function writeJobMeta(meta: JobMeta): void {
  const dir = getJobDir(meta.short)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
}

function reconcileMeta(meta: JobMeta): JobMeta {
  if (meta.status === 'running' && !isProcessRunning(meta.pid)) {
    const updated: JobMeta = { ...meta, status: 'exited', exitedAt: Date.now() }
    writeJobMeta(updated)
    return updated
  }
  return meta
}

function listJobs(): JobMeta[] {
  const root = getJobsRoot()
  if (!existsSync(root)) return []
  const result: JobMeta[] = []
  for (const short of readdirSync(root)) {
    const dir = join(root, short)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    const meta = readJobMeta(short)
    if (meta) result.push(reconcileMeta(meta))
  }
  result.sort((a, b) => b.startedAt - a.startedAt)
  return result
}

export type JobLookupResult =
  | { job: JobMeta }
  | { error: 'none' }
  | { error: 'ambiguous'; matches: JobMeta[] }

/**
 * Resolve a user-typed short id (or unique prefix) to exactly one job.
 * Ambiguous prefixes are an error — silently picking the first match
 * lets `ccb stop a` kill the wrong job when multiple jobs share that
 * prefix. Mirrors ant 4649.js ZC8 (which errors on >1 match).
 *
 * Pure helper over an explicit `jobs` list so tests don't need a
 * filesystem fixture; production callers should pass `listJobs()`.
 *
 * @dynamicRequire
 */
export function resolveJobShort(
  prefix: string,
  jobs: readonly JobMeta[],
): JobLookupResult {
  if (!prefix) return { error: 'none' }
  const exact = jobs.find(j => j.short === prefix)
  if (exact) return { job: exact }
  const prefixMatches = jobs.filter(j => j.short.startsWith(prefix))
  if (prefixMatches.length === 0) return { error: 'none' }
  if (prefixMatches.length === 1) return { job: prefixMatches[0]! }
  return { error: 'ambiguous', matches: [...prefixMatches] }
}

function findJobByPrefix(prefix: string): JobLookupResult {
  return resolveJobShort(prefix, listJobs())
}

/**
 * Helper for handlers that need a job-or-exit path. Prints the
 * appropriate error to stderr and exits with code 1, or returns the
 * matched job.
 */
function resolveJobOrExit(short: string): JobMeta {
  const result = findJobByPrefix(short)
  if ('job' in result) return result.job
  if (result.error === 'none') {
    process.stderr.write(`No job matching "${short}".\n`)
    process.exit(1)
  }
  process.stderr.write(
    `Ambiguous prefix "${short}", matches: ${result.matches.map(j => j.short).join(', ')}\n`,
  )
  process.exit(1)
}

// ─── handlers ───────────────────────────────────────────────────────

/** Cap on piped-stdin embedded into the bg directive (ant 4649.js fC8). */
const BG_STDIN_BYTE_CAP = 1024 * 1024

/**
 * Read piped stdin (non-TTY) up to BG_STDIN_BYTE_CAP. Returns '' if
 * stdin is a TTY or no data arrives within the timeout. Mirrors ant's
 * `ZJK` — used by `--bg` to let `cat task.md | ccb --bg "summarize"`
 * embed the file content into the directive.
 */
async function readBgStdin(timeoutMs = 3000): Promise<string> {
  if (process.stdin.isTTY) return ''
  process.stdin.setEncoding('utf8')
  let buf = ''
  let truncated = false
  const onData = (chunk: string): void => {
    if (truncated) return
    if (buf.length + chunk.length > BG_STDIN_BYTE_CAP) {
      buf += chunk.slice(0, BG_STDIN_BYTE_CAP - buf.length)
      truncated = true
      return
    }
    buf += chunk
  }
  process.stdin.on('data', onData)
  const timedOut = await new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(true), timeoutMs)
    process.stdin.once('end', () => {
      clearTimeout(timer)
      resolve(false)
    })
    process.stdin.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
  process.stdin.off('data', onData)
  if (timedOut) return ''
  if (truncated) {
    process.stderr.write(
      `warning: piped stdin exceeds ${BG_STDIN_BYTE_CAP} bytes, truncated\n`,
    )
  }
  return buf.replace(/\r?\n$/, '')
}

/**
 * Pre-flight check: disallow `--bg` with bypass-permissions or auto
 * mode unless the user has previously accepted the corresponding
 * disclaimer in an interactive session. Mirrors ant 4649.js qf3.
 *
 * Returns null if OK, an error message if blocked. The check protects
 * against a fresh-install user typing `ccb --bg --dangerously-skip-permissions
 * "..."` without ever seeing the warning interactively — `--bg`
 * detaches before any TUI dialog could surface.
 */
function checkBgPermissionGate(args: readonly string[]): string | null {
  const beforeDoubleDash = (() => {
    const i = args.indexOf('--')
    return i >= 0 ? args.slice(0, i) : args
  })()
  const permModeIdx = beforeDoubleDash.indexOf('--permission-mode')
  const permMode = permModeIdx >= 0 ? beforeDoubleDash[permModeIdx + 1] : undefined
  const wantsBypass =
    permMode === 'bypassPermissions' ||
    beforeDoubleDash.includes('--dangerously-skip-permissions') ||
    beforeDoubleDash.includes('--allow-dangerously-skip-permissions')
  if (wantsBypass && !hasSkipDangerousModePermissionPrompt()) {
    return '--bg with bypassPermissions requires accepting the disclaimer first. Run `ccb --dangerously-skip-permissions` once interactively.'
  }
  if (permMode === 'auto' && !hasAutoModeOptIn()) {
    return '--bg with auto mode requires opting in first. Run `ccb --permission-mode auto` once interactively.'
  }
  return null
}

/**
 * Spawn a backgrounded `ccb -p "<directive>"` and return immediately.
 * Strips `--bg` / `--background` from argv before respawning so the
 * child doesn't recurse.
 *
 * @dynamicRequire
 */
export async function handleBgFlag(args: readonly string[]): Promise<void> {
  const gateError = checkBgPermissionGate(args)
  if (gateError) {
    process.stderr.write(`${gateError}\n`)
    process.exit(1)
  }

  ensureJobsRoot()

  const { flags: forwardedFlags, directive: argvDirective } = splitBgArgs(args)
  let directive = argvDirective

  // Piped stdin support — `cat plan.md | ccb --bg "review this"` should
  // embed the file content alongside the argv directive. Mirrors ant
  // 4649.js iM3 → ZJK + RJK.
  const piped = await readBgStdin()
  if (piped) {
    directive = directive ? `${directive}\n${piped}` : piped
  }

  if (!directive) {
    process.stderr.write(
      'Usage: ccb --bg "<directive>"  (the prompt becomes the background task)\n',
    )
    process.exit(1)
  }

  // --bg-pty: Phase C PTY-host spawn instead of detached -p.
  if (args.includes('--bg-pty') || args.includes('--bg-interactive')) {
    const { spawnPtyHost } = await import('./bg/spawnPty.js')
    const short = generateShortId()
    const r = spawnPtyHost({ short, jobDir: getJobDir(short), flags: forwardedFlags, directive, cwd: process.cwd() })
    writeJobMeta({ ...r, ptySocket: r.socketPath, status: 'running' })
    { const m = await import('./bg/agentActionEvent.js'); m.emitAgentAction('spawn', short, { mode: 'pty' }); m.emitAgentDispatch(short, directive) }
    // Opportunistically ensure daemon is up so subsequent stop/respawn
    // route through RPC. Fire-and-forget.
    void import('./bg/daemonAdapter.js').then(async ({ isDaemonAlive, ensureDaemon }) => {
      if (!(await isDaemonAlive())) await ensureDaemon().catch(() => false)
    }).catch(() => {})
    return
  }

  await spawnBgJob({ flags: forwardedFlags, directive, cwd: process.cwd() })
}

/**
 * Spawn a single backgrounded ccb child + write its meta.json. Shared
 * between `--bg` (fresh) and `respawn` (re-launch from stored cmd).
 * Returns the new short id; on spawn failure exits with the OS-level
 * reason included.
 */
async function spawnBgJob(opts: {
  flags: readonly string[]
  directive: string
  cwd: string
}): Promise<string> {
  const short = generateShortId()
  const jobDir = getJobDir(short)
  mkdirSync(jobDir, { recursive: true })

  const stdoutFd = openSync(join(jobDir, 'stdout.log'), 'a')
  const stderrFd = openSync(join(jobDir, 'stderr.log'), 'a')

  // Resolve our own binary so the child runs the same ccb. argv[0] when
  // running from `bun dist/cli.js` or the compiled standalone binary is
  // already the right thing to spawn. Forward the user's flags through
  // (--model, --permission-mode, etc) so `ccb --bg --model X "task"`
  // doesn't lose model selection.
  const childArgs = [...opts.flags, '-p', opts.directive]
  // Two cases: when launched via `bun dist/cli.js`, argv0='bun' and
  // argv[1]='/.../dist/cli.js' — we need to invoke bun with cli.js as
  // the first arg so the child boots through bun. When launched via
  // the compiled standalone binary, argv0 IS the binary path and
  // argv[1] is the first user flag — invoke argv[0] directly.
  const isBun = process.argv0.endsWith('bun')
  const cmd = isBun ? process.argv0 : process.argv[0]!
  const nodeArgs = isBun
    ? [process.argv[1] ?? '', ...childArgs]
    : childArgs
  const fullCmd = [cmd, ...nodeArgs]

  // Marker env (parity with ant 4706.js xXK):
  // - CLAUDE_CODE_SESSION_KIND/CLAUDE_CODE_BG_JOB_SHORT: read by
  //   concurrentSessions.isBgSession() and by ps reconciliation.
  // - FORCE_COLOR/COLORTERM/BROWSER: child stdio is wired to a file fd
  //   (non-TTY), so chalk would strip colors and any "open in browser"
  //   path would try to spawn a browser. Force colors on, browser off.
  // - CLAUDE_JOB_DIR: ant compat marker recording the job's on-disk
  //   directory so future tooling can find it without re-deriving.
  // ant 4706.js xXK env. BG_BACKEND='detached' (ant 'daemon') = daemon-less.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CODE_SESSION_KIND: 'bg', CLAUDE_CODE_BG_JOB_SHORT: short,
    FORCE_COLOR: '3', COLORTERM: 'truecolor', BROWSER: 'true',
    CLAUDE_JOB_DIR: jobDir, CLAUDE_BG_BACKEND: 'detached',
    CLAUDE_BG_SOURCE: 'cli', CLAUDE_ENABLE_STREAM_WATCHDOG: '1',
    CLAUDE_CODE_SESSION_NAME: short,
  }

  const spawnOpts: SpawnOptions = {
    cwd: opts.cwd,
    env,
    detached: true,
    stdio: ['ignore', stdoutFd, stderrFd],
  }

  const child = spawn(cmd, nodeArgs, spawnOpts)
  child.unref()

  // Spawn failure (child.pid === undefined) means the kernel rejected
  // the exec — bad binary path, missing dir, etc. Clean up the half-
  // written job dir + print the underlying error rather than leaving
  // an orphaned `unknown`-status entry that ps will keep showing.
  if (child.pid === undefined) {
    rmSync(getJobDir(short), { recursive: true, force: true })
    const reason = await new Promise<string>(resolve => {
      const timer = setTimeout(() => resolve('spawn failed (no error event)'), 200)
      child.once('error', (err: Error) => {
        clearTimeout(timer)
        resolve(err.message)
      })
    })
    process.stderr.write(
      `Failed to background ccb child: ${reason}\n  cmd: ${fullCmd.join(' ')}\n`,
    )
    process.exit(1)
  }

  const { readProcStart } = await import('@claude-code/daemon/bgWorkerRegistry.js')
  const meta: JobMeta = {
    short, pid: child.pid, cmd: fullCmd, cwd: opts.cwd,
    startedAt: Date.now(), status: 'running',
    procStart: readProcStart(child.pid) || undefined,
    cliVersion: MACRO.VERSION,
  }
  writeJobMeta(meta)

  // Pretty hint output: cyan short, dim hints (ant 4649.js tw6).
  const d = (l: string, r: string) => chalk.dim(`  ${l.padEnd(26)}${r}`)
  process.stdout.write(
    [
      `backgrounded · ${chalk.cyan(short)}`,
      d('ccb ps', 'list sessions'),
      d(`ccb logs ${short}`, 'show recent output'),
      d(`ccb logs ${short} -f`, 'follow output live'),
      d(`ccb stop ${short}`, 'stop this session (SIGTERM)'),
      d(`ccb rm   ${short}`, 'remove the job directory'),
      '',
    ].join('\n'),
  )
  return short
}

/** @dynamicRequire */
export async function psHandler(args: readonly string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      `Usage: ccb ps\n\n  List active and recently-exited background sessions from ~/.claude/jobs/.\n  Reconciles status against live PIDs on each invocation.\n`,
    )
    return
  }
  const jobs = listJobs()
  if (jobs.length === 0) {
    process.stdout.write('No background jobs.\n')
    return
  }
  const header = ['SHORT'.padEnd(JOB_SHORT_LENGTH + 2), 'STATUS  ', 'PID    ', 'AGE      ', 'CMD'].join('  ')
  process.stdout.write(header + '\n')
  for (const j of jobs) {
    const cmdSummary = truncate(
      j.cmd.length > 2 ? j.cmd.slice(2).join(' ') : j.cmd.join(' '),
      60,
    )
    process.stdout.write(
      [
        j.short.padEnd(JOB_SHORT_LENGTH + 2),
        j.status.padEnd(8),
        String(j.pid).padEnd(7),
        formatRelativeTime(j.startedAt).padEnd(9),
        cmdSummary,
      ].join('  ') + '\n',
    )
  }
}

/** @dynamicRequire */
export async function logsHandler(args: readonly string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      `Usage: ccb logs <short> [-f|--follow] [--tail N|-n N]\n\n  Print the background session's stdout and stderr from ~/.claude/jobs/.\n  -f / --follow   Stream new output as it appears (200ms poll).\n  --tail N        Limit to the last N lines (caps follow-mode backlog seed).\n`,
    )
    return
  }
  const positional = args.filter(a => !a.startsWith('-'))
  const short = positional[0]
  if (!short) {
    process.stderr.write(
      'Usage: ccb logs <short> [-f|--follow] [--tail N]\n',
    )
    process.exit(1)
  }
  const job = resolveJobOrExit(short)
  const stdoutPath = join(getJobDir(job.short), 'stdout.log')
  const stderrPath = join(getJobDir(job.short), 'stderr.log')
  const follow = args.includes('-f') || args.includes('--follow')

  // --tail N: print only the last N lines and exit (or seed the follow
  // stream so a long-running job doesn't dump megabytes of backlog).
  let tailLines: number | undefined
  const tailIdx = args.findIndex(a => a === '--tail' || a === '-n')
  if (tailIdx >= 0) {
    const v = args[tailIdx + 1]
    if (!v) {
      process.stderr.write('--tail requires a numeric argument (e.g. --tail 200)\n')
      process.exit(1)
    }
    const parsed = Number.parseInt(v, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      process.stderr.write(`--tail value "${v}" is not a positive integer\n`)
      process.exit(1)
    }
    tailLines = parsed
  }

  if (follow) {
    // pty-mode + daemon alive → subscribe to live ring stream.
    if (job.mode === 'pty' && job.status === 'running') {
      const { isDaemonAlive } = await import('./bg/daemonAdapter.js')
      if (await isDaemonAlive()) {
        const { followLogsViaDaemon } = await import('./bg/logsSubscribe.js')
        followLogsViaDaemon({
          short: job.short,
          pollStatus: () => reconcileMeta(readJobMeta(job.short) ?? job).status,
        })
        return
      }
    }
    // Simple polling tail (fallback). Bun's spawn isn't quite the right
    // primitive here (no `tail -F` upstream); a 200ms poll keeps the
    // implementation self-contained and platform-portable.
    let stdoutPos = 0
    let stderrPos = 0
    const writeNew = (path: string, lastPos: number, sink: NodeJS.WriteStream): number => {
      try {
        const stat = statSync(path)
        if (stat.size <= lastPos) return lastPos
        const fd = openSync(path, 'r')
        const buf = Buffer.alloc(stat.size - lastPos)
        readSync(fd, buf, 0, buf.length, lastPos)
        closeSync(fd)
        sink.write(buf.toString('utf8'))
        return stat.size
      } catch {
        return lastPos
      }
    }
    // Initial seed: --tail N caps the backlog; otherwise dump everything.
    if (tailLines !== undefined) {
      if (existsSync(stdoutPath)) {
        process.stdout.write(tailFile(stdoutPath, tailLines))
        stdoutPos = statSync(stdoutPath).size
      }
      if (existsSync(stderrPath)) {
        process.stderr.write(tailFile(stderrPath, tailLines))
        stderrPos = statSync(stderrPath).size
      }
    } else {
      if (existsSync(stdoutPath)) stdoutPos = writeNew(stdoutPath, 0, process.stdout)
      if (existsSync(stderrPath)) stderrPos = writeNew(stderrPath, 0, process.stderr)
    }

    const tick = (): void => {
      if (existsSync(stdoutPath)) stdoutPos = writeNew(stdoutPath, stdoutPos, process.stdout)
      if (existsSync(stderrPath)) stderrPos = writeNew(stderrPath, stderrPos, process.stderr)
      const fresh = reconcileMeta(readJobMeta(job.short) ?? job)
      if (fresh.status !== 'running') {
        process.stdout.write(`\n[job ${fresh.short} ${fresh.status}]\n`)
        process.exit(0)
      }
    }
    setInterval(tick, 200).unref()
    // Keep the process alive on follow.
    setInterval(() => {}, 1 << 30).unref()
    return
  }

  // Non-follow: dump (or tail) both streams.
  if (tailLines !== undefined) {
    if (existsSync(stdoutPath)) {
      process.stdout.write(tailFile(stdoutPath, tailLines))
    }
    if (existsSync(stderrPath)) {
      const tail = tailFile(stderrPath, tailLines)
      if (tail.length > 0) process.stderr.write(tail)
    }
  } else {
    if (existsSync(stdoutPath)) {
      process.stdout.write(readFileSync(stdoutPath, 'utf8'))
    }
    if (existsSync(stderrPath)) {
      const errBytes = readFileSync(stderrPath)
      if (errBytes.byteLength > 0) {
        process.stderr.write(errBytes)
      }
    }
  }
}

/** Thin delegating wrapper to bg/stopJob.ts (extracted for LOC budget). */
async function stopJob(
  job: JobMeta,
  opts: { force: boolean; verbLabel: string; finalStatus: 'stopped' | 'killed' },
): Promise<void> {
  const { stopJob: doStopJob } = await import('./bg/stopJob.js')
  await doStopJob(job, opts, patch =>
    writeJobMeta({ ...job, ...patch } as JobMeta),
  )
}

/** @dynamicRequire */
export async function stopHandler(args: readonly string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      `Usage: ccb stop <short> [--force]\n\n  Stop a running background session. By default sends SIGTERM (graceful);\n  --force / -9 escalates to SIGKILL.\n`,
    )
    return
  }
  const positional = args.filter(a => !a.startsWith('-'))
  const short = positional[0]
  const force = args.includes('--force') || args.includes('-9')
  if (!short) {
    process.stderr.write('Usage: ccb stop <short> [--force]\n')
    process.exit(1)
  }
  const job = resolveJobOrExit(short)
  ;(await import('./bg/agentActionEvent.js')).emitAgentAction(force ? 'kill' : 'stop', job.short)
  await stopJob(job, {
    force,
    verbLabel: force ? 'Killed' : 'Stopped',
    finalStatus: force ? 'killed' : 'stopped',
  })
}

/** Alias for `stop --force`. @dynamicRequire */
export async function killHandler(args: readonly string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      `Usage: ccb kill <short>\n\n  Alias for \`ccb stop --force\` — sends SIGKILL immediately.\n`,
    )
    return
  }
  const positional = args.filter(a => !a.startsWith('-'))
  const short = positional[0]
  if (!short) {
    process.stderr.write('Usage: ccb kill <short>   (alias of `ccb stop --force`)\n')
    process.exit(1)
  }
  const job = resolveJobOrExit(short)
  ;(await import('./bg/agentActionEvent.js')).emitAgentAction('kill', job.short)
  await stopJob(job, { force: true, verbLabel: 'Killed', finalStatus: 'killed' })
}

/** @dynamicRequire */
export async function rmHandler(args: readonly string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      `Usage: ccb rm <short>\n\n  Remove a stopped background session's job directory (meta.json + log files).\n  Refuses to act on a still-running job — \`ccb stop\` it first.\n`,
    )
    return
  }
  const short = args[0]
  if (!short) {
    process.stderr.write('Usage: ccb rm <short>\n')
    process.exit(1)
  }
  const job = resolveJobOrExit(short)
  if (job.status === 'running') {
    process.stderr.write(
      `Job ${job.short} is still running. Run "ccb kill ${job.short}" first.\n`,
    )
    process.exit(1)
  }
  ;(await import('./bg/agentActionEvent.js')).emitAgentAction('rm', job.short)
  rmSync(getJobDir(job.short), { recursive: true, force: true })
  process.stdout.write(`Removed ${job.short}.\n`)
}

/** @dynamicRequire */
export async function attachHandler(args: readonly string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      `Usage: ccb attach <short>\n  pty-mode: bidirectional (Ctrl+Q detach). detached-mode: logs --follow.\n`,
    )
    return
  }
  const positional = args.filter(a => !a.startsWith('-'))
  if (!positional[0]) {
    process.stderr.write('Usage: ccb attach <short>\n')
    process.exit(1)
  }
  const job = resolveJobOrExit(positional[0]!)
  ;(await import('./bg/agentActionEvent.js')).emitAgentAction('attach', job.short, { mode: job.mode ?? 'detached' })
  if (job.mode === 'pty' && job.ptySocket) {
    const { runAttach } = await import('./bg/attachClient.js')
    await runAttach(job.ptySocket, job.short)
    return
  }
  // detached-mode is non-PTY: log + fall through to logs --follow.
  ;(await import('./bg/agentActionEvent.js')).emitAgentActionRaw('tengu_bg_attach_legacy_autorespawn', { short: job.short, mode: job.mode ?? 'detached' })
  process.stderr.write(`attach: detached-mode job — streaming read-only. Use --bg-pty for bidirectional.\n`)
  await logsHandler([job.short, '--follow', '--tail', '200'])
}

/**
 * `ccb respawn <short>|--all` — restart a bg job (or all live ones)
 * using the same directive + flags. Mirrors ant 4649.js sM3, daemon-
 * less: stop+rm the old job and spawn fresh. New short id is issued
 * (ant preserves the id via daemon — not feasible without one). Exit
 * 0 if all respawns succeeded, 1 if any failed.
 *
 * @dynamicRequire
 */
export async function respawnHandler(args: readonly string[]): Promise<void> {
  const positional = args.filter(a => !a.startsWith('-'))
  const arg = args[0]
  if (arg === '--help' || arg === '-h') {
    process.stdout.write(
      `Usage: ccb respawn <short>|--all\n\n  Restart a background session (or all live ones) using the original directive + flags.\n  Issued a new short id; the old job dir is removed.\n`,
    )
    return
  }

  if (args.includes('--all')) {
    const targets = listJobs().filter(j => j.status === 'running')
    if (targets.length === 0) {
      process.stdout.write('no live jobs to respawn\n')
      return
    }
    let okCount = 0
    for (const j of targets) {
      const restarted = await respawnSingle(j)
      if (restarted) okCount++
    }
    if (okCount < targets.length) process.exit(1)
    return
  }

  const short = positional[0]
  if (!short) {
    process.stderr.write('Usage: ccb respawn <short>|--all\n')
    process.exit(1)
  }
  const job = resolveJobOrExit(short)
  ;(await import('./bg/agentActionEvent.js')).emitAgentAction('respawn', job.short)
  const ok = await respawnSingle(job)
  if (!ok) process.exit(1)
}

async function respawnSingle(job: JobMeta): Promise<boolean> {
  // pty-mode + daemon alive → daemon respawn (preserves short id).
  if (job.mode === 'pty') {
    const { isDaemonAlive, daemonRespawn } = await import('./bg/daemonAdapter.js')
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
    try { process.kill(job.pid, 'SIGTERM') } catch {/**/}
  }
  rmSync(getJobDir(job.short), { recursive: true, force: true })
  try {
    let newShort: string
    if (job.mode === 'pty') {
      const { spawnPtyHost } = await import('./bg/spawnPty.js')
      newShort = generateShortId()
      const r = spawnPtyHost({
        short: newShort, jobDir: getJobDir(newShort), ...args, cwd: job.cwd,
      })
      writeJobMeta({ ...r, ptySocket: r.socketPath, status: 'running' })
    } else {
      newShort = await spawnBgJob({ ...args, cwd: job.cwd })
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

export { extractRespawnArgs, splitBgArgs, tailFile }
export { runPtyHost } from './bg/ptyHost.js'
