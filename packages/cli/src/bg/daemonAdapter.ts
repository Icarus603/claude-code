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

import { logEvent } from '@claude-code/local-observability'
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
 * Skew-nudge poll — ant 4639.js hM3(). Tolerates a daemon mid-restart
 * (upgrade, KILL+respawn). Sends `nudge` op repeatedly for up to 10s,
 * returning 'up' as soon as the daemon answers `restarting:false`. If
 * daemon stays unreachable returns 'down'.
 */
export async function nudgeDaemonSkew(): Promise<'up' | 'down'> {
  const start = Date.now()
  const deadline = start + 10_000
  let lastReason: 'restarting' | 'etimeout' | 'enoconn' = 'restarting'
  while (Date.now() < deadline) {
    const r = await daemonRequest('nudge', {}, { timeoutMs: 1000 })
    if (r.ok && r.op === 'nudge') {
      if (!(r as Record<string, unknown>).restarting) {
        if (Date.now() - start > 200) {
          logEvent('tengu_bg_skew_nudge', { converged: 'true', duration_ms: String(Date.now() - start) })
        }
        return 'up'
      }
      lastReason = 'restarting'
      await new Promise(res => setTimeout(res, 100))
      continue
    }
    if (!r.ok && r.code === 'ETIMEOUT') {
      lastReason = 'etimeout'
      await new Promise(res => setTimeout(res, 100))
      continue
    }
    if (!r.ok && r.code === 'ENOCONN') {
      lastReason = 'enoconn'
      await new Promise(res => setTimeout(res, 100))
      continue
    }
    return 'up'
  }
  logEvent('tengu_bg_skew_nudge', {
    converged: 'false',
    restarting: String(lastReason === 'restarting'),
    etimeout: String(lastReason === 'etimeout'),
    enoconn: String(lastReason === 'enoconn'),
  })
  return 'down'
}

/**
 * Poll for daemon liveness up to deadlineMs. Used after install/spawn
 * to wait for the daemon to come up. Mirrors ant 4639.js HiH().
 */
export async function waitForDaemon(deadlineMs: number): Promise<boolean> {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    if (await isDaemonAlive()) return true
    await new Promise(res => setTimeout(res, 100))
  }
  return false
}

interface DaemonStateFile {
  pid: number
  startedAt: number
  origin?: string
  version?: string
}

/**
 * Read the daemon's state.json (written by bgDaemon on boot). Returns
 * null if the file is missing or unreadable. Mirrors ant 4639.js j2().
 */
export async function readDaemonState(): Promise<DaemonStateFile | null> {
  try {
    const { homedir } = await import('node:os')
    const { join } = await import('node:path')
    const { readFile } = await import('node:fs/promises')
    const path = join(homedir(), '.claude', 'daemon', 'state.json')
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as DaemonStateFile
  } catch {
    return null
  }
}

/**
 * Detect a zombie daemon: state.json shows a pid that's still alive,
 * but the control socket isn't answering ping. ant 4639.js ijK(). When
 * detected, the caller should signal restart to the supervisor pid.
 *
 * Returns null if no zombie (daemon is alive or process is dead),
 * otherwise an error string explaining what we couldn't fix.
 */
export async function probeDaemonZombie(): Promise<string | null> {
  const state = await readDaemonState()
  if (!state || Date.now() - state.startedAt <= 5000) return null
  const ping = await daemonRequest('ping', {}, { timeoutMs: 1000 })
  const stateMeta = {
    started_ago_ms: String(Date.now() - state.startedAt),
    origin_transient: String(state.origin === 'transient'),
    origin_service: String(state.origin === 'service'),
  }
  if (ping.ok || ping.code === 'ETIMEOUT') {
    logEvent('tengu_bg_daemon_zombie_false_positive', { ...stateMeta, recheck_etimeout: String(!ping.ok) })
    return null
  }
  let alive = false
  try {
    process.kill(state.pid, 0)
    alive = true
  } catch {
    alive = false
  }
  if (!alive) return null
  try {
    process.kill(state.pid, 'SIGTERM')
    logEvent('tengu_bg_daemon_zombie_restart', { pid: String(state.pid), ...stateMeta })
    return null
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'EPERM') return `daemon socket missing; could not restart supervisor (EPERM)`
    return `daemon zombie restart failed: ${err.message}`
  }
}

function spawnTransient(): void {
  const isBun = process.argv0.endsWith('bun')
  const cmd = isBun ? process.argv0 : process.argv[0]!
  const cliJs = isBun ? [process.argv[1] ?? ''] : []
  const child = spawn(cmd, [...cliJs, 'daemon', 'bg', 'run'], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, CLAUDE_CODE_DAEMON_TRANSIENT: '1' },
  })
  child.unref()
}

async function pollAlive(deadlineMs: number): Promise<boolean> {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    if (await isDaemonAlive()) return true
    await new Promise(r => setTimeout(r, SPAWN_POLL_MS))
  }
  return false
}

/**
 * Ensure a daemon is reachable. If not, spawn a transient one and
 * wait up to 5s for it to come up. Returns true on success, false if
 * we couldn't get a daemon up (caller falls back to daemon-less).
 *
 * Mirrors ant 4640.js wg() — opts.forceTransient skips the LaunchAgent
 * install path even when one would normally be offered.
 */
export async function ensureDaemon(opts: { forceTransient?: boolean } = {}): Promise<boolean> {
  if (await isDaemonAlive()) return true
  void opts.forceTransient
  spawnTransient()
  return pollAlive(SPAWN_WAIT_MS)
}

/**
 * Cold-start prompt — ant 4640.js vX_(). When daemon is dead and we're
 * on a TTY (not CI), ask whether the user wants to install it as a
 * persistent service vs. running a transient instance for this session.
 *
 * Returns true if a daemon is reachable after the prompt (regardless of
 * which path was taken). Caller responsibility to invoke only when they
 * actually need daemon access.
 */
export async function ensureDaemonInteractive(): Promise<boolean> {
  if (await isDaemonAlive()) return true
  const start = Date.now()
  if (
    !process.stdin.isTTY ||
    !process.stderr.isTTY ||
    process.env.CI === 'true' ||
    process.platform !== 'darwin'
  ) {
    spawnTransient()
    const ok = await pollAlive(SPAWN_WAIT_MS)
    logEvent('tengu_bg_daemon_install', {
      outcome_ok: String(ok),
      via_service: 'false',
      fresh_install: 'false',
      duration_ms: String(Date.now() - start),
    })
    return ok
  }
  process.stderr.write(
    'No background daemon is running.\nInstalling it as a service keeps the daemon up across reboot so background sessions stay available.\n',
  )
  logEvent('tengu_bg_daemon_cold_start_ask', {})
  const answer = await promptYesNoOnceNever('Install as a service now? [y/N/never, or "once" just for now] ')
  logEvent('tengu_bg_daemon_cold_start_ask_answer', {
    answer_yes: String(answer === 'yes'),
    answer_once: String(answer === 'once'),
    answer_never: String(answer === 'never'),
  })
  if (answer === 'yes') {
    const { homedir } = await import('node:os')
    const { join } = await import('node:path')
    const { installLaunchAgent } = await import('@claude-code/daemon/launchAgent.js')
    const ccbDir = join(homedir(), '.claude', 'daemon')
    const r = await installLaunchAgent({
      jsonPath: join(ccbDir, 'state.json'),
      logPath: join(ccbDir, 'daemon.log'),
    })
    if (!r.ok) {
      logEvent('tengu_bg_daemon_install', { outcome_ok: 'false', via_service: 'true', fresh_install: 'true', duration_ms: String(Date.now() - start) })
      process.stderr.write(`Service install failed (${r.error}). Falling back to a transient daemon.\n`)
      spawnTransient()
      const ok = await pollAlive(SPAWN_WAIT_MS)
      logEvent('tengu_bg_daemon_install', { outcome_ok: String(ok), via_service: 'false', fresh_install: 'false', duration_ms: String(Date.now() - start) })
      return ok
    }
    process.stderr.write(`Installed: ${r.servicePath}\nRun 'ccb daemon bg uninstall' to undo.\n`)
    const ok = await pollAlive(5000)
    logEvent('tengu_bg_daemon_install', { outcome_ok: String(ok), via_service: 'true', fresh_install: 'true', duration_ms: String(Date.now() - start) })
    return ok
  }
  spawnTransient()
  const ok = await pollAlive(SPAWN_WAIT_MS)
  logEvent('tengu_bg_daemon_install', { outcome_ok: String(ok), via_service: 'false', fresh_install: 'false', duration_ms: String(Date.now() - start) })
  return ok
}

async function promptYesNoOnceNever(q: string): Promise<'yes' | 'no' | 'once' | 'never'> {
  const rl = (await import('node:readline')).createInterface({
    input: process.stdin,
    output: process.stderr,
  })
  try {
    const ans = await new Promise<string>(resolve => {
      rl.once('close', () => resolve('n'))
      rl.question(q, resolve)
    })
    const a = ans.trim().toLowerCase()
    if (a === 'y' || a === 'yes') return 'yes'
    if (a === 'once' || a === 'o') return 'once'
    if (a === 'never') return 'never'
    return 'no'
  } finally {
    rl.close()
  }
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

/**
 * Send a dispatch op (ant 4648.js MC8 socket path). Spawns the worker
 * AND records a nonce; caller follows up with daemonAwaitAck.
 */
export async function daemonDispatch(payload: {
  short: string
  nonce: string
  cwd: string
  env: Record<string, string | undefined>
  ptySocket: string
  cmd: readonly string[]
  cliVersion: string
  source?: 'shell' | 'slash' | 'fleet' | 'spare' | 'respawn'
  agent?: string
  worktree?: string
}): Promise<DaemonResponse> {
  const start = Date.now()
  const r = await daemonRequest('dispatch', { d: payload }, { timeoutMs: 10_000 })
  if (r.ok) {
    logEvent('tengu_bg_dispatch', {
      backend_daemon: 'true',
      source_shell: String(payload.source === 'shell'),
      source_slash: String(payload.source === 'slash'),
      source_fleet: String(payload.source === 'fleet'),
      source_spare: String(payload.source === 'spare'),
      source_respawn: String(payload.source === 'respawn'),
      has_worktree: String(payload.worktree !== undefined),
      has_agent: String(payload.agent !== undefined),
      ms: String(Date.now() - start),
      via: String((r as Record<string, unknown>).via ?? 'socket'),
    })
  } else {
    logEvent('tengu_bg_dispatch_fallback', {
      ms: String(Date.now() - start),
      reason_unreachable: String(r.code === 'ENOCONN'),
      reason_ack_timeout: String(r.code === 'ETIMEOUT'),
      reason_stale_short: String(r.code === 'ESTALE'),
      reason_short_alive: String(r.code === 'EALIVE'),
      detail: String(r.error ?? '').slice(0, 80),
    })
  }
  return r
}

/**
 * Block waiting for a dispatched worker to ack its nonce. Returns ok
 * with `pid` + `messagingSock`, or ESTARTING if the ack budget hasn't
 * elapsed yet (caller should retry).
 */
export async function daemonAwaitAck(opts: {
  short: string
  nonce: string
}): Promise<DaemonResponse> {
  return daemonRequest('await-ack', opts, { timeoutMs: 10_000 })
}
