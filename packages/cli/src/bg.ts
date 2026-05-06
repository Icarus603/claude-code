/**
 * `--bg` / `ccb ps` / `ccb logs` / `ccb stop` / `ccb attach` / `ccb rm`
 * — OS-level background sessions.
 *
 * Mirrors the user-facing surface of ant v2.1.131 4649.js (NJK) — but
 * the implementation is intentionally daemon-less. ant runs a long-
 * lived daemon at `~/.local/share/ccb/daemon.sock` that supervises
 * jobs, owns the PTY, and routes attach/logs/stop over a Unix socket.
 *
 * That architecture is the right answer for the full ant feature set
 * (interactive `attach` reconnect, multi-client streams, cross-cwd
 * roster, respawn on crash) but it carries a lot of moving parts
 * (daemon lifecycle, socket protocol, PTY plumbing). For ccb the user
 * need is narrower: "spawn a task, close the terminal, come back
 * later and read its output". That's solvable without a daemon:
 *
 *   spawn ccb -p "<directive>" with detached:true + stdio→file
 *     + unref() → parent exits immediately, child outlives terminal
 *
 *   `~/.claude/jobs/<short>/{meta.json, stdout.log, stderr.log}`
 *     → ps/logs/kill operate on this directory directly
 *
 * The daemon-managed PTY-attach path stays out of scope for Phase B.
 * If/when a user wants live `attach`, that becomes Phase C and we
 * graft a daemon supervisor in front of the same on-disk layout. The
 * job dir schema is forward-compatible: a future daemon adds a socket
 * file alongside meta.json and the existing ps/logs/kill keep working.
 *
 * Subcommand surface (verb names mirror ant 4649.js for muscle-memory
 * parity — `stop` is graceful, `kill` is the same path with SIGKILL):
 *   ccb --bg "<directive>"   spawn a backgrounded -p run
 *   ccb ps                   list active + recent sessions
 *   ccb logs <short>         tail stdout/stderr (-f follow, --tail N)
 *   ccb stop <short>         SIGTERM (graceful); `--force` upgrades to SIGKILL
 *   ccb kill <short>         alias for `stop --force`
 *   ccb attach <short>       alias for `logs --follow` (no PTY in this build)
 *   ccb rm <short>           remove the job dir (only when stopped)
 *
 * Daemon-managed PTY-attach (true reconnect) stays out of scope for
 * Phase B. The job dir layout is forward-compatible — Phase C grafts
 * a daemon supervisor in front of `~/.claude/jobs/<short>/` without
 * breaking existing ps/logs/stop callsites.
 */

import { spawn, type SpawnOptions } from 'node:child_process'
import { randomBytes } from 'node:crypto'
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

/**
 * `ps` aux–style probe: send signal 0 (no-op kill) and check whether
 * the kernel reports the process is running. ESRCH = dead, EPERM =
 * exists but we can't signal it (counts as running).
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    return err.code === 'EPERM'
  }
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

function formatRelativeTime(ms: number): string {
  const delta = Math.max(0, Date.now() - ms)
  const seconds = Math.floor(delta / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

// ─── handlers ───────────────────────────────────────────────────────

/**
 * Mirror of ant 4649.js fC8 — 1 MiB cap on piped-stdin payload that gets
 * embedded into the background directive. Anything past this is silently
 * truncated with a stderr warning, same as ant.
 */
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
  const childArgs = [...forwardedFlags, '-p', directive]
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

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Mark the child so it knows it's backgrounded (parity with ant
    // CLAUDE_CODE_SESSION_KIND=bg). Read back by concurrentSessions.ts.
    CLAUDE_CODE_SESSION_KIND: 'bg',
    CLAUDE_CODE_BG_JOB_SHORT: short,
  }

  const opts: SpawnOptions = {
    cwd: process.cwd(),
    env,
    detached: true,
    stdio: ['ignore', stdoutFd, stderrFd],
  }

  const child = spawn(cmd, nodeArgs, opts)
  child.unref()

  // Spawn failure (child.pid === undefined) means the kernel rejected
  // the exec — bad binary path, missing dir, etc. Clean up the half-
  // written job dir + print the underlying error rather than leaving
  // an orphaned `unknown`-status entry that ps will keep showing.
  if (child.pid === undefined) {
    rmSync(getJobDir(short), { recursive: true, force: true })
    // Wait one tick for the async 'error' event so we can include the
    // OS-level reason in the message; if it doesn't fire, we still
    // exit with a generic message.
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

  const meta: JobMeta = {
    short,
    pid: child.pid,
    cmd: fullCmd,
    cwd: process.cwd(),
    startedAt: Date.now(),
    status: 'running',
  }
  writeJobMeta(meta)

  process.stdout.write(
    [
      `backgrounded · ${short}`,
      `  ccb ps                list sessions`,
      `  ccb logs ${short}     show recent output`,
      `  ccb logs ${short} -f  follow output live`,
      `  ccb stop ${short}     stop this session (SIGTERM)`,
      `  ccb rm   ${short}     remove the job directory`,
      '',
    ].join('\n'),
  )
}

/** @dynamicRequire */
export async function psHandler(_args: readonly string[]): Promise<void> {
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
    // Simple polling tail. Bun's spawn isn't quite the right primitive
    // here (no `tail -F` upstream); a 200ms poll keeps the
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

/**
 * Shared termination worker — owns the SIGTERM/SIGKILL escalation and
 * meta-bookkeeping. Both `stopHandler` (SIGTERM) and `killHandler`
 * (SIGKILL via the `--force` shortcut) funnel through here so the
 * exit-code accounting and "already gone" reconciliation only live in
 * one place.
 */
function stopJob(
  job: JobMeta,
  opts: { force: boolean; verbLabel: string; finalStatus: 'stopped' | 'killed' },
): void {
  if (job.status !== 'running') {
    process.stderr.write(
      `Job ${job.short} is not running (status=${job.status}).\n`,
    )
    process.exit(0)
  }
  const signal: NodeJS.Signals = opts.force ? 'SIGKILL' : 'SIGTERM'
  try {
    process.kill(job.pid, signal)
    writeJobMeta({
      ...job,
      status: opts.finalStatus,
      killedAt: Date.now(),
    })
    process.stdout.write(
      `${opts.verbLabel} ${job.short} (pid ${job.pid}, ${signal}).\n`,
    )
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ESRCH') {
      writeJobMeta({ ...job, status: 'exited', exitedAt: Date.now() })
      process.stdout.write(`Job ${job.short} was already exited.\n`)
    } else {
      process.stderr.write(`Failed to ${opts.verbLabel.toLowerCase()} ${job.short}: ${err.message}\n`)
      process.exit(1)
    }
  }
}

/** @dynamicRequire */
export async function stopHandler(args: readonly string[]): Promise<void> {
  const positional = args.filter(a => !a.startsWith('-'))
  const short = positional[0]
  const force = args.includes('--force') || args.includes('-9')
  if (!short) {
    process.stderr.write('Usage: ccb stop <short> [--force]\n')
    process.exit(1)
  }
  const job = resolveJobOrExit(short)
  stopJob(job, {
    force,
    verbLabel: force ? 'Killed' : 'Stopped',
    finalStatus: force ? 'killed' : 'stopped',
  })
}

/**
 * Alias for `stop --force`. ant 4649.js exposes `stop` only — `kill` is
 * a ccb-side affordance kept undocumented in --help but live in argv
 * dispatch so muscle memory from `kill <pid>` works.
 */
/** @dynamicRequire */
export async function killHandler(args: readonly string[]): Promise<void> {
  const positional = args.filter(a => !a.startsWith('-'))
  const short = positional[0]
  if (!short) {
    process.stderr.write('Usage: ccb kill <short>   (alias of `ccb stop --force`)\n')
    process.exit(1)
  }
  const job = resolveJobOrExit(short)
  stopJob(job, { force: true, verbLabel: 'Killed', finalStatus: 'killed' })
}

/** @dynamicRequire */
export async function rmHandler(args: readonly string[]): Promise<void> {
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
  rmSync(getJobDir(job.short), { recursive: true, force: true })
  process.stdout.write(`Removed ${job.short}.\n`)
}

/**
 * `attach` without a daemon-managed PTY is fundamentally read-only —
 * we can stream output but can't deliver keystrokes back to a child
 * whose stdin was wired to /dev/null at spawn. The honest behavior is
 * to forward to `logs --follow`: same UX, same exit semantics, and a
 * one-line note so users know why they can't type into the session.
 *
 * When Phase C grafts in the daemon supervisor with a real PTY, this
 * can grow real bidirectional reconnect; the call surface stays the
 * same so any existing scripts keep working.
 */
/** @dynamicRequire */
export async function attachHandler(args: readonly string[]): Promise<void> {
  const positional = args.filter(a => !a.startsWith('-'))
  if (!positional[0]) {
    process.stderr.write('Usage: ccb attach <short>\n')
    process.exit(1)
  }
  const job = resolveJobOrExit(positional[0]!)
  process.stderr.write(
    `attach: this build streams output read-only (no PTY supervisor yet).\n` +
      `        showing live tail; the session keeps running if you Ctrl+C here.\n`,
  )
  await logsHandler([job.short, '--follow', '--tail', '200'])
}

// Re-export pure helpers extracted into ./bg/ subdir, for the
// __tests__/bg.test.ts import path (it imports from `../bg.js`).
export { splitBgArgs, tailFile }
