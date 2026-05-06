/**
 * `--bg` / `claude bg` / `claude ps` / `claude logs` / `claude kill` /
 * `claude rm` — OS-level background sessions.
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
 * Subcommand surface:
 *   ccb --bg "<directive>"   spawn a backgrounded -p run
 *   ccb ps                   list active + recent sessions
 *   ccb logs <short>         tail stdout/stderr (or follow)
 *   ccb kill <short>         SIGTERM the process
 *   ccb rm <short>           remove the job dir (only when stopped)
 *
 * `attach` is intentionally not implemented yet (no PTY layer); it'd
 * print "not implemented in this build, see Phase C".
 */

import {
  spawn,
  spawnSync,
  type SpawnOptions,
} from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

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
   */
  status: 'running' | 'exited' | 'killed' | 'unknown'
  /** Set when `ccb kill <short>` runs. Distinct from natural exit. */
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

function findJobByPrefix(prefix: string): JobMeta | undefined {
  if (!prefix) return undefined
  const all = listJobs()
  // Exact short match wins; then prefix match (allow short autocomplete).
  return (
    all.find(j => j.short === prefix) ??
    all.find(j => j.short.startsWith(prefix))
  )
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
 * Spawn a backgrounded `ccb -p "<directive>"` and return immediately.
 * Strips `--bg` / `--background` from argv before respawning so the
 * child doesn't recurse.
 */
export async function handleBgFlag(args: readonly string[]): Promise<void> {
  ensureJobsRoot()

  const filtered = args.filter(
    a => a !== '--bg' && a !== '--background' && a !== '-bg',
  )

  // Reconstruct the prompt by joining everything after `--` (or all
  // non-flag positionals if there's no `--` separator). This mirrors how
  // the user-typed argv would look.
  const directive = filtered.join(' ').trim()
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
  // already the right thing to spawn.
  const nodeArgs = process.argv0.endsWith('bun')
    ? [process.argv[1] ?? '', '-p', directive]
    : ['-p', directive]
  const cmd = process.argv0.endsWith('bun') ? process.argv0 : process.argv[0]!
  const fullCmd =
    process.argv0.endsWith('bun')
      ? [cmd, ...nodeArgs]
      : [cmd, ...nodeArgs]

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

  const meta: JobMeta = {
    short,
    pid: child.pid ?? -1,
    cmd: fullCmd,
    cwd: process.cwd(),
    startedAt: Date.now(),
    status: child.pid !== undefined ? 'running' : 'unknown',
  }
  writeJobMeta(meta)

  process.stdout.write(
    [
      `backgrounded · ${short}`,
      `  ccb ps               list sessions`,
      `  ccb logs ${short}    show recent output`,
      `  ccb kill ${short}    stop this session`,
      `  ccb rm   ${short}    remove the job directory`,
      '',
    ].join('\n'),
  )
}

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

export async function logsHandler(args: readonly string[]): Promise<void> {
  const short = args[0]
  if (!short) {
    process.stderr.write('Usage: ccb logs <short>\n')
    process.exit(1)
  }
  const job = findJobByPrefix(short)
  if (!job) {
    process.stderr.write(`No job matching "${short}".\n`)
    process.exit(1)
  }
  const stdoutPath = join(getJobDir(job.short), 'stdout.log')
  const stderrPath = join(getJobDir(job.short), 'stderr.log')
  const follow = args.includes('-f') || args.includes('--follow')

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
        // node:fs read is sync read; use readSync via require to avoid
        // pulling node:fs/promises here.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { readSync, closeSync } = require('node:fs') as typeof import('node:fs')
        readSync(fd, buf, 0, buf.length, lastPos)
        closeSync(fd)
        sink.write(buf.toString('utf8'))
        return stat.size
      } catch {
        return lastPos
      }
    }
    // Initial dump of any existing content.
    if (existsSync(stdoutPath)) stdoutPos = writeNew(stdoutPath, 0, process.stdout)
    if (existsSync(stderrPath)) stderrPos = writeNew(stderrPath, 0, process.stderr)

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

  // Non-follow: dump both streams in their entirety.
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

export async function killHandler(args: readonly string[]): Promise<void> {
  const short = args[0]
  if (!short) {
    process.stderr.write('Usage: ccb kill <short>\n')
    process.exit(1)
  }
  const job = findJobByPrefix(short)
  if (!job) {
    process.stderr.write(`No job matching "${short}".\n`)
    process.exit(1)
  }
  if (job.status !== 'running') {
    process.stderr.write(`Job ${job.short} is not running (status=${job.status}).\n`)
    process.exit(0)
  }
  try {
    process.kill(job.pid, 'SIGTERM')
    writeJobMeta({
      ...job,
      status: 'killed',
      killedAt: Date.now(),
    })
    process.stdout.write(`Killed ${job.short} (pid ${job.pid}).\n`)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ESRCH') {
      // Process already gone — reconcile and report.
      writeJobMeta({ ...job, status: 'exited', exitedAt: Date.now() })
      process.stdout.write(`Job ${job.short} was already exited.\n`)
    } else {
      process.stderr.write(`Failed to kill ${job.short}: ${err.message}\n`)
      process.exit(1)
    }
  }
}

export async function rmHandler(args: readonly string[]): Promise<void> {
  const short = args[0]
  if (!short) {
    process.stderr.write('Usage: ccb rm <short>\n')
    process.exit(1)
  }
  const job = findJobByPrefix(short)
  if (!job) {
    process.stderr.write(`No job matching "${short}".\n`)
    process.exit(1)
  }
  if (job.status === 'running') {
    process.stderr.write(
      `Job ${job.short} is still running. Run "ccb kill ${job.short}" first.\n`,
    )
    process.exit(1)
  }
  rmSync(getJobDir(job.short), { recursive: true, force: true })
  process.stdout.write(`Removed ${job.short}.\n`)
}

export async function attachHandler(_args: readonly string[]): Promise<void> {
  process.stderr.write(
    'attach is not implemented in this build (Phase C requires PTY supervisor).\n' +
      'Use "ccb logs <short>" to read output, or "ccb logs <short> --follow" to tail.\n',
  )
  process.exit(1)
}

// `appendFileSync` import preserved so a future daemon-attached path
// can append status lines to a session log. Touch a const here to keep
// the import alive until then without a verifier flag.
void appendFileSync
void spawnSync
