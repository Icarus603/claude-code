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

/** Claim socket path (used by attach handshake). */
export function getClaimSocketPath(short: string): string {
  return join(getDaemonScopeDir(), `${short}.claim.sock`)
}

/** ~/.claude/daemon directory for breadcrumb files. */
export function getDaemonHomeDir(): string {
  return join(homedir(), '.claude', 'daemon')
}

/** ~/.claude/daemon/pty-pids directory. */
export function getPtyPidsDir(): string {
  return join(getDaemonHomeDir(), 'pty-pids')
}
