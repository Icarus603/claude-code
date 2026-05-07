/**
 * CLI-side adapter for daemon RPC routing.
 *
 * Provides:
 *   - `isDaemonAlive()` — fast ping (1s timeout)
 *   - `ensureDaemon()` — ping; if dead, spawn transient daemon and wait
 *   - `daemonStop({short, force})` — sends kill op, awaits confirmed:true
 *   - `daemonRespawn({short})` — sends respawn op, returns new pid
 *   - `daemonList()` — sends list op, returns workers array
 *
 * On any daemon-unreachable, the caller falls back to the existing
 * direct-process-kill path. Mirrors ant 4640.js `vX_()` / `wg()`
 * behaviour: "try daemon, fall back to transient spawn, fall back to
 * error."
 *
 * @dynamicRequire
 */

import { spawn } from 'node:child_process'

import {
  daemonRequest,
  type Response as DaemonResponse,
} from '@claude-code/daemon/daemonClient.js'

const PING_TIMEOUT_MS = 1000
const SPAWN_WAIT_MS = 5000
const SPAWN_POLL_MS = 100

/** Quick liveness check. Returns true if daemon answered ping in 1s. */
export async function isDaemonAlive(): Promise<boolean> {
  const r = await daemonRequest('ping', {}, { timeoutMs: PING_TIMEOUT_MS })
  return r.ok === true
}

/**
 * Ensure a daemon is reachable. If not, spawn a transient one and
 * wait up to 5s for it to come up. Returns true on success, false if
 * we couldn't get a daemon up (caller falls back to daemon-less).
 */
export async function ensureDaemon(): Promise<boolean> {
  if (await isDaemonAlive()) return true

  const isBun = process.argv0.endsWith('bun')
  const cmd = isBun ? process.argv0 : process.argv[0]!
  const cliJs = isBun ? [process.argv[1] ?? ''] : []

  const child = spawn(cmd, [...cliJs, 'daemon', 'bg', 'run'], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, CLAUDE_CODE_DAEMON_TRANSIENT: '1' },
  })
  child.unref()

  // Poll for daemon liveness up to SPAWN_WAIT_MS.
  const deadline = Date.now() + SPAWN_WAIT_MS
  while (Date.now() < deadline) {
    if (await isDaemonAlive()) return true
    await new Promise(r => setTimeout(r, SPAWN_POLL_MS))
  }
  return false
}

/**
 * Send a kill op to the daemon. Caller already verified the daemon
 * is reachable. Returns the response (typically `{ok:true, confirmed:true}`).
 */
export async function daemonKill(opts: {
  short: string
  force?: boolean
}): Promise<DaemonResponse> {
  return daemonRequest(
    'kill',
    { short: opts.short, force: opts.force ?? false },
    { timeoutMs: 5000 },
  )
}

/** Send a respawn op. Returns the response with new pid. */
export async function daemonRespawn(short: string): Promise<DaemonResponse> {
  return daemonRequest('respawn', { short }, { timeoutMs: 10_000 })
}

/** Send a list op. Returns the response with `jobs[]`. */
export async function daemonList(): Promise<DaemonResponse> {
  return daemonRequest('list', {}, { timeoutMs: 2000 })
}

/**
 * Send a spawn op. Mirrors ant 4648.js MC8 dispatch — daemon spawns
 * the worker on our behalf so `attach` semantics work. Returns
 * `{ok:true, short, pid}` on success.
 */
export async function daemonSpawn(payload: {
  short: string
  cwd: string
  env: Record<string, string | undefined>
  ptySocket: string
  cmd: readonly string[]
  cliVersion: string
  dispatch?: Record<string, unknown>
}): Promise<DaemonResponse> {
  return daemonRequest(
    'spawn',
    { d: payload },
    { timeoutMs: 10_000 },
  )
}
