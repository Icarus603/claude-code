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
import { getDefaultLauncher } from '@claude-code/repl/relaunch.js'

const PING_TIMEOUT_MS = 1000
// ant v2.1.140 4722.js:78 — service-install path waits 5s for the
// just-installed launchd job to bind its socket; the daemon binary itself
// starts ~instantly, the 5s budget covers launchd's bootstrap latency.
const SERVICE_POLL_WAIT_MS = 5000
// ant v2.1.140 4722.js:128 — transient spawn (no launchd) waits 20s for the
// child to bind. Bumped from 10s in v139 to accommodate enterprise endpoint
// security (Crowdstrike, SentinelOne, Defender) injecting up to ~10s of
// scanning latency on first binary execution before the process can even
// start its event loop.
const TRANSIENT_SPAWN_WAIT_MS = 20000
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
  // ant 5286.js uKO equivalent via getDefaultLauncher (ccb's Pb).
  // The old `process.argv0.endsWith('bun')` heuristic mis-detected
  // standalone binaries — see packages/cli/src/bg/spawnPty.ts incident.
  const launcher = getDefaultLauncher({ pinToCurrentBinary: true })
  const cmd = launcher.cmd
  const prefixArgs = launcher.prefixArgs
  try {
    const child = spawn(cmd, [...prefixArgs, 'daemon', 'bg', 'run'], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
      env: { ...process.env, CLAUDE_CODE_DAEMON_TRANSIENT: '1' },
    })
    child.once('error', err => {
      const code = (err as NodeJS.ErrnoException).code ?? 'unknown'
      logEvent('tengu_bg_daemon_spawn_failed', {
        errno_enoent: String(code === 'ENOENT'),
        errno_eacces: String(code === 'EACCES'),
        errno: code,
      })
    })
    child.unref()
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? 'unknown'
    logEvent('tengu_bg_daemon_spawn_failed', {
      errno_enoent: String(code === 'ENOENT'),
      errno_eacces: String(code === 'EACCES'),
      errno: code,
    })
  }
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
  return pollAlive(TRANSIENT_SPAWN_WAIT_MS)
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
    const ok = await pollAlive(TRANSIENT_SPAWN_WAIT_MS)
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
  // ant 5170 also emits the un-prefixed cold_start_prompt for the
  // daemon-namespace telemetry. Same payload, different sink.
  logEvent('tengu_daemon_cold_start_prompt', {})
  const answer = await promptYesNoOnceNever('Install as a service now? [y/N/never, or "once" just for now] ')
  logEvent('tengu_bg_daemon_cold_start_ask_answer', {
    answer_yes: String(answer === 'yes'),
    answer_once: String(answer === 'once'),
    answer_never: String(answer === 'never'),
  })
  // ant tengu_daemon_install_prompt_answer — daemon-namespace mirror
  // of the bg cold-start answer telemetry.
  logEvent('tengu_daemon_install_prompt_answer', {
    answer_yes: String(answer === 'yes'),
    answer_once: String(answer === 'once'),
    answer_never: String(answer === 'never'),
  })
  if (answer === 'yes') {
    const { homedir } = await import('node:os')
    const { join } = await import('node:path')
    const { installLaunchAgent, isLaunchAgentStale } = await import('@claude-code/daemon/launchAgent.js')
    // ant 4639.js: detect stale plist (deleted binary path) before install.
    if (await isLaunchAgentStale()) {
      logEvent('tengu_bg_daemon_service_stale_exec', {})
    }
    const ccbDir = join(homedir(), '.claude', 'daemon')
    const r = await installLaunchAgent({
      jsonPath: join(ccbDir, 'state.json'),
      logPath: join(ccbDir, 'daemon.log'),
    })
    if (!r.ok) {
      logEvent('tengu_bg_daemon_install', { outcome_ok: 'false', via_service: 'true', fresh_install: 'true', duration_ms: String(Date.now() - start) })
      process.stderr.write(`Service install failed (${r.error}). Falling back to a transient daemon.\n`)
      spawnTransient()
      const ok = await pollAlive(TRANSIENT_SPAWN_WAIT_MS)
      logEvent('tengu_bg_daemon_install', { outcome_ok: String(ok), via_service: 'false', fresh_install: 'false', duration_ms: String(Date.now() - start) })
      return ok
    }
    process.stderr.write(`Installed: ${r.servicePath}\nRun 'ccb daemon bg uninstall' to undo.\n`)
    const ok = await pollAlive(SERVICE_POLL_WAIT_MS)
    if (!ok) {
      // ant 4639.js: service installed but daemon didn't bind socket within
      // 5s — fall back to transient. Often means launchd queued bootstrap
      // behind another job or the binary takes >5s to cold-start.
      logEvent('tengu_bg_daemon_service_poll_fallthrough', { duration_ms: String(Date.now() - start) })
    }
    logEvent('tengu_bg_daemon_install', { outcome_ok: String(ok), via_service: 'true', fresh_install: 'true', duration_ms: String(Date.now() - start) })
    return ok
  }
  spawnTransient()
  const ok = await pollAlive(TRANSIENT_SPAWN_WAIT_MS)
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

/**
 * Port of ant v2.1.132 WJK→uMK (4666.js) — ack-timeout redispatch.
 *
 * When daemonAwaitAck returns ETIMEOUT but the worker is still alive
 * (the daemon's awaitAck handler exhausted its own budget while the
 * worker actually started fine), spending another dispatch + ack cycle
 * usually succeeds. Without this, transient PTY-init contention surfaces
 * as a hard "worker failed to start" error and the user has to retry by
 * hand.
 *
 * Error classification:
 *   - `daemon_unavailable` — ENOCONN / ESOCKET — daemon not running.
 *   - `transient_exhausted` — ETIMEOUT after rescue retry — worker
 *     really is wedged; caller should fall back to in-process spawn.
 *   - `stalled` — ESTALE — daemon thinks worker is dead but it's not.
 */
export type BgDispatchFailureKind =
  | 'daemon_unavailable'
  | 'transient_exhausted'
  | 'stalled'

export function classifyBgDispatchFailure(
  r: DaemonResponse,
): BgDispatchFailureKind | null {
  if (r.ok) return null
  if (r.code === 'ENOCONN' || r.code === 'ESOCKET') return 'daemon_unavailable'
  if (r.code === 'ETIMEOUT') return 'transient_exhausted'
  if (r.code === 'ESTALE' || r.code === 'EALIVE') return 'stalled'
  return null
}

/**
 * Dispatch + await-ack with one automatic redispatch attempt on
 * ack-timeout. Emits `tengu_bg_dispatch_rescued` on successful retry,
 * matching ant's telemetry payload for the same pattern.
 */
export async function daemonDispatchWithAckTimeoutRescue(payload: {
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
  const first = await daemonDispatch(payload)
  if (first.ok) {
    const ack = await daemonAwaitAck({
      short: payload.short,
      nonce: payload.nonce,
    })
    if (ack.ok) return ack
    const kind = classifyBgDispatchFailure(ack)
    if (kind === 'transient_exhausted') {
      // Re-dispatch with the same short — the daemon's dispatch handler
      // dedupes on `short`, so this returns either the existing worker
      // (already running, just slow to ack) or spawns fresh. 5s budget
      // matches ant's redispatch window.
      const retry = await daemonRequest(
        'dispatch',
        { d: payload },
        { timeoutMs: 5000 },
      )
      if (retry.ok) {
        const ack2 = await daemonAwaitAck({
          short: payload.short,
          nonce: payload.nonce,
        })
        if (ack2.ok) {
          logEvent('tengu_bg_dispatch_rescued', {
            short: payload.short,
            reason: 'ack-timeout-redispatch',
          })
          return ack2
        }
      }
    }
    return ack
  }
  return first
}

/**
 * ant 5164.js wF3 — request daemon to SIGKILL+respawn a worker that
 * stalled at startup (attach client never saw first frame). Daemon
 * tracks attachStallRespawns counter; on 2nd call returns EGAVEUP.
 */
export async function daemonRespawnStalled(short: string): Promise<DaemonResponse> {
  return daemonRequest('respawn-stalled', { short }, { timeoutMs: 10_000 })
}

/**
 * Detach a worker from the daemon's active supervision (kill('stop')
 * semantics) without killing the inner process. Worker stays running;
 * `ccb attach <short>` can still find it; subsequent stop/kill ops
 * succeed because the daemon keeps the vm in its `detached` map.
 */
export async function daemonDetach(short: string): Promise<DaemonResponse> {
  return daemonRequest('detach', { short }, { timeoutMs: 5000 })
}

/**
 * Submit a dispatch envelope through the file-spool fallback path.
 * ant 5165.js — when socket dispatch fails (ENOCONN/ETIMEOUT), CLI
 * writes the envelope to ~/.claude/daemon/dispatch/ where the daemon's
 * fs.watch picks it up. Survives daemon restart between CLI write +
 * daemon read; socket-only dispatch loses any in-flight request when
 * daemon dies mid-handle.
 *
 * Returns the spooled file path (caller can poll the daemon socket
 * for ack later via daemonAwaitAck if needed).
 */
export async function submitDispatchToSpool(payload: {
  op: string
  d: Record<string, unknown>
  nonce?: string
}): Promise<string> {
  const { writeSpoolEnvelope } = await import('@claude-code/daemon/dispatchSpool.js')
  return writeSpoolEnvelope({
    createdAt: Date.now(),
    op: payload.op,
    d: payload.d,
    ...(payload.nonce && { nonce: payload.nonce }),
  })
}
