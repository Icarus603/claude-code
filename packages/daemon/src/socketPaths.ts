/**
 * Daemon socket path resolution.
 *
 * Mirrors ant 4138.js / 4137.js path layout, adapted for ccb's
 * vendor-prefix convention:
 *
 *   $TMPDIR/cc-daemon-<uid>/<repo-hash>/control.sock        rendezvous
 *   $TMPDIR/cc-daemon-<uid>/<repo-hash>/<short>.pty.sock    per-job PTY
 *   $TMPDIR/cc-daemon-<uid>/<repo-hash>/<short>.claim.sock  per-job claim
 *   ~/.claude/daemon/pty-pids/<short>.pid                   pid breadcrumbs
 *   ~/.claude/daemon/pty-pids/<short>.err                   crash breadcrumbs
 *
 * The repo-hash is sha256(realpath(cwd-at-start-of-time)) sliced to 8
 * hex chars. ant uses cwd to scope daemons to one cwd-tree at a time;
 * ccb keeps the same scoping so a `/repo-A` daemon doesn't try to
 * adopt `/repo-B` jobs.
 *
 * @dynamicRequire
 */

import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Cached realpath-of-cwd hash for stability across sub-calls. */
let cachedRepoHash: string | undefined

function getTmpRoot(): string {
  // Termux has a non-/tmp default; respect it.
  const termuxPrefix = process.env.PREFIX
  if (process.env.TERMUX_VERSION && termuxPrefix) {
    return join(termuxPrefix, 'tmp')
  }
  return tmpdir() || '/tmp'
}

function getRepoHash(): string {
  if (cachedRepoHash) return cachedRepoHash
  cachedRepoHash = createHash('sha256')
    .update(resolve(process.cwd()))
    .digest('hex')
    .slice(0, 8)
  return cachedRepoHash
}

/** ant He() — `<tmp>/cc-daemon-<uid>/<repo-hash>` */
export function getDaemonScopeDir(): string {
  const uid = process.getuid?.() ?? 0
  return join(getTmpRoot(), `cc-daemon-${uid}`, getRepoHash())
}

/** ant oU() — control socket path. */
export function getControlSocketPath(): string {
  if (process.platform === 'win32') {
    // Windows uses a named pipe; ant has WV8('control'). For ccb we
    // mirror that name; full Windows daemon support is out of scope
    // for this iteration (Bun.Terminal availability + signal model
    // differs).
    return `\\\\.\\pipe\\ccb-control`
  }
  return join(getDaemonScopeDir(), 'control.sock')
}

/** PTY socket path for a given job short id. */
export function getPtySocketPath(short: string): string {
  return join(getDaemonScopeDir(), `${short}.pty.sock`)
}

/**
 * Rendezvous (control) socket path, given a job directory.
 *
 * ant runs TWO sockets per bg worker: the PTY socket carries screen
 * bytes (attach/replay), and a SEPARATE rendezvous socket carries the
 * out-of-band control channel (ant 4291.js worker-side server bound on
 * `CLAUDE_BG_RENDEZVOUS_SOCK`; ant 5016.js `naK` supervisor-side client).
 * ant's layout is `<scope>/rv/<short>.sock`; ccb keeps its existing flat
 * per-job-dir convention (the PTY socket is `<jobDir>/pty.sock` — see
 * `spawnPty.ts`), so the rendezvous socket sits alongside it as
 * `<jobDir>/rv.sock`.
 *
 * The rendezvous socket is what lets the INNER bg REPL push authoritative
 * `state` / `done` / `heartbeat` frames to the daemon supervisor without
 * round-tripping through disk. ccb previously had no such channel — the
 * inner REPL is sandboxed inside the PTY (stdout is screen bytes), so the
 * daemon could only infer liveness from PTY ctrl-frame heartbeats and guess
 * turn-outcome from a regex over assistant text (`useBgFleetStateSync`).
 */
export function getRendezvousSocketPath(jobDir: string): string {
  return join(jobDir, 'rv.sock')
}

/** Claim socket path (used by attach handshake). */
export function getClaimSocketPath(short: string): string {
  return join(getDaemonScopeDir(), `${short}.claim.sock`)
}

/**
 * ~/.claude/daemon directory for breadcrumb files. Respects
 * CLAUDE_CONFIG_HOME for consistency with bgWorkerRegistry.getJobsRoot()
 * and so unit tests can isolate by pointing the env var at a tmpdir.
 */
export function getDaemonHomeDir(): string {
  const root = process.env.CLAUDE_CONFIG_HOME
  return root ? join(root, 'daemon') : join(homedir(), '.claude', 'daemon')
}

/** ~/.claude/daemon/pty-pids directory. */
export function getPtyPidsDir(): string {
  return join(getDaemonHomeDir(), 'pty-pids')
}
