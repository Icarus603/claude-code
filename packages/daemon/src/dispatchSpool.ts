/**
 * File-spool dispatch fallback — ant 5165.js XF3/EFK/fF3.
 *
 * Watches `~/.claude/daemon/dispatch/` for incoming dispatch envelope
 * files. Each file is one dispatch request that the CLI couldn't deliver
 * via socket (e.g. daemon mid-restart). Daemon picks up via fs.watch on
 * boot + every 5s rescan, validates schema/size/age, applies as if it
 * were a socket dispatch, deletes on success or moves to `rejected/` on
 * failure.
 *
 * Survives daemon restart between CLI write and daemon read — the file
 * just sits there until next daemon comes up. socket-only dispatch
 * loses any in-flight request when daemon dies mid-handle.
 *
 * ccb uses Node `fs.watch` instead of chokidar (one less dep). On macOS
 * fs.watch fires 'rename' events on file create AND delete — we filter
 * by lstat to distinguish, plus poll every 5s as backup since fs.watch
 * can miss events under load.
 *
 * @dynamicRequire
 */

import {
  type FSWatcher,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  watch,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { logEvent } from '@claude-code/local-observability'

/** ant 5165.js DF3 — max age before a spool file is considered stale (24h). */
const MAX_AGE_MS = 86_400_000
/** ant 5165.js MF3 — max body size for a single dispatch envelope (256 KiB). */
const MAX_BODY_BYTES = 262_144

export interface DispatchEnvelope {
  /** ms-epoch when CLI wrote this envelope. Daemon rejects if too old. */
  createdAt: number
  /** Daemon op to invoke once envelope is ingested. Same as socket op. */
  op: string
  /** Op payload (passed to handler as msg.d). */
  d: Record<string, unknown>
  /** Optional nonce for await-ack pairing. */
  nonce?: string
}

function getSpoolDir(): string {
  return join(homedir(), '.claude', 'daemon', 'dispatch')
}

function getRejectedDir(): string {
  return join(getSpoolDir(), 'rejected')
}

function isTempFile(name: string): boolean {
  return name.endsWith('.tmp') || name.includes('.tmp.')
}

/**
 * ant 5165.js NrH — move a bad envelope to rejected/ subdir.
 */
function rejectFile(path: string, reason: string): void {
  try {
    mkdirSync(getRejectedDir(), { recursive: true, mode: 0o700 })
    const dest = join(getRejectedDir(), basename(path))
    try { renameSync(path, dest) } catch { unlinkSync(path) }
  } catch {
    // best-effort — can't reject, just unlink
    try { unlinkSync(path) } catch { /**/ }
  }
  logEvent('tengu_bg_dispatch_rejected', { reason: reason.slice(0, 100) })
}

/**
 * ant 5165.js EFK — process one envelope file. Returns `null` on success
 * (file consumed) or a rejection reason string. Sync because daemon
 * dispatch path is synchronous; the actual handler invocation is async
 * via the deliver callback which the caller awaits.
 */
export async function ingestEnvelope(
  path: string,
  deliver: (env: DispatchEnvelope) => Promise<void> | void,
): Promise<string | null> {
  let stat
  try {
    stat = lstatSync(path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    rejectFile(path, (e as Error).message)
    return 'read-failed'
  }
  if (stat.isSymbolicLink()) {
    rejectFile(path, 'symlink')
    return 'symlink'
  }
  if (stat.size > MAX_BODY_BYTES) {
    rejectFile(path, `oversized (${stat.size} bytes)`)
    return 'oversized'
  }
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    rejectFile(path, (e as Error).message)
    return 'read-failed'
  }
  let env: DispatchEnvelope
  try {
    env = JSON.parse(raw) as DispatchEnvelope
  } catch {
    rejectFile(path, 'bad-json')
    return 'bad-json'
  }
  if (!env || typeof env !== 'object' || typeof env.op !== 'string' || typeof env.createdAt !== 'number' || !env.d || typeof env.d !== 'object') {
    rejectFile(path, 'schema')
    return 'schema'
  }
  if (Date.now() - env.createdAt > MAX_AGE_MS) {
    rejectFile(path, 'stale')
    return 'stale'
  }
  try {
    await deliver(env)
  } catch (e) {
    rejectFile(path, `deliver-failed: ${(e as Error).message.slice(0, 60)}`)
    return 'deliver-failed'
  }
  try { unlinkSync(path) } catch { /**/ }
  return null
}

/**
 * ant 5165.js fF3 — drain any pre-existing files in spool dir on boot.
 * Called by daemon startup before fs.watch is set up so any files
 * written between previous daemon shutdown and this boot get processed.
 */
export async function drainSpool(
  deliver: (env: DispatchEnvelope) => Promise<void> | void,
): Promise<void> {
  const dir = getSpoolDir()
  if (!existsSync(dir)) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
    throw e
  }
  for (const name of entries) {
    if (name.startsWith('.') || isTempFile(name) || name === 'rejected') continue
    await ingestEnvelope(join(dir, name), deliver)
  }
}

export interface SpoolWatcher {
  close(): void
}

/**
 * ant 5165.js XF3 — start the file-watcher on the spool dir. Caller
 * provides `deliver` which routes the envelope through the same op
 * dispatch table the socket server uses.
 *
 * fs.watch is best-effort — a 5s polling timer covers cases where the
 * watcher misses the event (high system load, FS event coalescing).
 */
export function startSpoolWatcher(
  deliver: (env: DispatchEnvelope) => Promise<void> | void,
): SpoolWatcher {
  const dir = getSpoolDir()
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  } catch (e) {
    logEvent('tengu_bg_dispatch_watcher_failed', {
      errno: (e as NodeJS.ErrnoException).code ?? 'unknown',
      reason: 'mkdir',
    })
  }
  let watcher: FSWatcher | undefined
  try {
    watcher = watch(dir, { persistent: false }, (_event, filename) => {
      if (!filename) return
      const fname = String(filename)
      if (isTempFile(fname) || fname === 'rejected' || fname.startsWith('.')) return
      const path = join(dir, fname)
      // Only ingest on existence (i.e. add or rename-into); ENOENT means rename-out.
      if (!existsSync(path)) return
      void ingestEnvelope(path, deliver).catch(() => {})
    })
    watcher.on('error', e => {
      logEvent('tengu_bg_dispatch_watcher_failed', {
        errno: (e as NodeJS.ErrnoException).code ?? 'unknown',
      })
    })
  } catch (e) {
    logEvent('tengu_bg_dispatch_watcher_failed', {
      errno: (e as NodeJS.ErrnoException).code ?? 'unknown',
      reason: 'watch-setup',
    })
  }
  // 5s poll backup (ant doesn't have this — chokidar polls internally on macOS).
  const pollTimer = setInterval(() => {
    void drainSpool(deliver).catch(() => {})
  }, 5000)
  pollTimer.unref()
  return {
    close(): void {
      if (watcher) try { watcher.close() } catch { /**/ }
      clearInterval(pollTimer)
    },
  }
}

/**
 * Write a dispatch envelope to the spool dir. Caller-side helper used
 * by CLI when daemon socket is unreachable.
 *
 * Atomic-write via tmp + rename (so the watcher never sees a partial
 * file). Returns the path to the spooled envelope.
 */
export function writeSpoolEnvelope(env: DispatchEnvelope): string {
  const dir = getSpoolDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const id = `${env.createdAt}-${Math.random().toString(36).slice(2, 10)}`
  const tmp = join(dir, `${id}.tmp`)
  const dest = join(dir, `${id}.json`)
  const { writeFileSync } = require('node:fs') as typeof import('node:fs')
  writeFileSync(tmp, JSON.stringify(env), { mode: 0o600 })
  renameSync(tmp, dest)
  return dest
}
