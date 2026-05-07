/**
 * Per-bg-worker state machine. ant 4706.js vm class, ported.
 *
 * Each WorkerVm wraps:
 *   - A spawned child process (`ccb --bg-pty-host <sock> ... -- <inner>`)
 *   - State machine (spawning → running → upgrading|retiring → retired)
 *   - Adopter (PTY socket bridge)
 *   - Ring buffer of recent output (1MB cap; for subscribe replay)
 *   - Set of currently-attached client sockets
 *   - Backoff timer for respawn-on-crash
 *   - fastCrashStreak counter
 *
 * @dynamicRequire
 */

import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'

import { logEvent } from '@claude-code/local-observability'
import {
  type WorkerPhase,
  type WorkerRecord,
  FAST_CRASH_LIMIT,
  FAST_CRASH_WINDOW_MS,
  HEARTBEAT_POLL_MS,
  MAX_RESPAWN_ATTEMPTS,
  RESPAWN_BACKOFF_MS,
  STALLED_THRESHOLD_MS,
  isPidAlive,
  readProcStart,
  verifyAdoption,
  writeWorkerRecord,
} from './bgWorkerRegistry.js'

const RING_BUFFER_BYTES = 1024 * 1024

/** Minimal sink interface; subscribers can be sockets or in-test stubs. */
export interface AttacherSink {
  write(chunk: Buffer | string): boolean | undefined
  end?(): void
}

/** Spawn-time payload for the inner ccb child. */
export interface WorkerSpawnConfig {
  short: string
  cwd: string
  env: NodeJS.ProcessEnv
  ptySocket: string
  /** ccb binary + args, e.g. `[bun, /cli.js, --bg-pty-host, <sock>, ...]`. */
  cmd: readonly string[]
  cliVersion: string
  /** Original dispatch envelope (preserved for respawn). */
  dispatch?: Record<string, unknown>
}

export type SettleOutcome = 'done' | 'crashed' | 'killed'

/**
 * Worker VM. One instance per bg job. Owns subprocess lifecycle.
 */
export class WorkerVm extends EventEmitter {
  readonly short: string
  private record: WorkerRecord
  private readonly config: WorkerSpawnConfig
  private phase: WorkerPhase
  private readonly ring: Buffer[] = []
  private ringBytes = 0
  private readonly attachers: Set<AttacherSink> = new Set()
  private fastCrashStreak = 0
  private attempt = 0
  private backoffTimer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private settled: SettleOutcome | null = null
  /** Last time the worker emitted ring data; used by stall watchdog. */
  private lastActivityAt: number = Date.now()
  private stalledFiredAt: number = 0

  constructor(config: WorkerSpawnConfig, initialRecord?: WorkerRecord) {
    super()
    this.short = config.short
    this.config = config
    this.phase = { kind: 'spawning', attempt: 0 }
    this.record =
      initialRecord ??
      ({
        short: config.short,
        pid: -1,
        cmd: config.cmd,
        cwd: config.cwd,
        startedAt: Date.now(),
        status: 'running',
        mode: 'pty',
        ptySocket: config.ptySocket,
        attempt: 0,
        fastCrashStreak: 0,
      } as WorkerRecord)
  }

  /** Current phase snapshot. */
  getPhase(): WorkerPhase {
    return this.phase
  }

  /** Current record snapshot. */
  getRecord(): WorkerRecord {
    return this.record
  }

  /** True when phase is `running` and pid is set. */
  isRunning(): boolean {
    return this.phase.kind === 'running' && this.record.pid > 0
  }

  /** True when phase is `retiring` with reason='reap'. */
  isKilling(): boolean {
    return this.phase.kind === 'retiring' && this.phase.reason === 'reap'
  }

  /** True when phase is `retiring` with reason='grace'. */
  isRetiring(): boolean {
    return this.phase.kind === 'retiring' && this.phase.reason === 'grace'
  }

  /** True when phase is `retiring` with reason='stop' (detached). */
  isDetached(): boolean {
    return this.phase.kind === 'retiring' && this.phase.reason === 'stop'
  }

  /** Push output bytes into the ring buffer. */
  pushOutput(chunk: Buffer): void {
    this.lastActivityAt = Date.now()
    this.stalledFiredAt = 0 // reset so re-stall fires fresh tengu_bg_worker_stalled
    this.ring.push(chunk)
    this.ringBytes += chunk.length
    while (this.ringBytes > RING_BUFFER_BYTES && this.ring.length > 1) {
      const dropped = this.ring.shift()!
      this.ringBytes -= dropped.length
    }
    for (const a of this.attachers) {
      try {
        a.write(chunk)
      } catch {
        // best-effort; if the attacher socket is gone, the close
        // handler on the server side will remove it.
      }
    }
    // Emit 'write' so classifier orchestrator + dispatch ack listeners
    // can react to ring activity. EventEmitter accepts string event names;
    // we forward chunk as the payload.
    this.emit('write', chunk)
  }

  /** Snapshot of current ring buffer for replay-on-attach. */
  getRingSnapshot(): Buffer[] {
    return [...this.ring]
  }

  /** Add an attacher; returns a fn to remove it. */
  addAttacher(sink: AttacherSink): () => void {
    this.attachers.add(sink)
    return () => {
      this.attachers.delete(sink)
    }
  }

  attacherCount(): number {
    return this.attachers.size
  }

  /**
   * Initiate spawn. Forks the child described by `config.cmd` with
   * stdio:[ignore, ignore, ignore] (PTY-host writes to its own
   * socket, not stdout/err). Sets phase=running on successful spawn.
   */
  spawn(): void {
    this.phase = { kind: 'spawning', attempt: this.attempt }
    const [cmd, ...args] = this.config.cmd
    if (!cmd) {
      logEvent('tengu_bg_pty_unavailable', { short: this.config.short, reason: 'empty_cmd' })
      this.settle('crashed')
      return
    }
    // ant spawn_cwd_gone — cwd deleted between meta write and respawn.
    if (!existsSync(this.config.cwd)) {
      logEvent('tengu_bg_spawn_cwd_gone', { short: this.config.short, cwd: this.config.cwd })
      this.settle('crashed')
      return
    }
    const child = spawn(cmd, args, {
      cwd: this.config.cwd,
      env: this.config.env,
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    child.unref()
    if (child.pid === undefined) {
      logEvent('tengu_bg_pty_unavailable', { short: this.config.short, reason: 'spawn_no_pid' })
      this.settle('crashed')
      return
    }
    this.record = {
      ...this.record,
      pid: child.pid,
      startedAt: Date.now(),
      attempt: this.attempt,
      procStart: readProcStart(child.pid) || undefined,
    }
    writeWorkerRecord(this.record)
    this.phase = { kind: 'running' }
    this.startHeartbeatPoll()
    logEvent('tengu_bg_worker_spawn', {
      short: this.config.short,
      pid: String(child.pid),
      attempt: String(this.attempt),
    })
    this.emit('spawned', child.pid)
  }

  /** Adopt an existing record (e.g. on daemon startup). */
  adopt(record: WorkerRecord): void {
    this.record = record
    this.attempt = record.attempt ?? 0
    this.fastCrashStreak = record.fastCrashStreak ?? 0
    const v = verifyAdoption(record)
    if (v === 'dead' || v === 'recycled') {
      this.settle(v === 'recycled' ? 'crashed' : 'done')
      return
    }
    this.phase = { kind: 'running' }
    this.startHeartbeatPoll()
  }

  /**
   * Periodic poll: detect when the worker dies without us noticing
   * (no SIGCHLD because we're a different process tree after the
   * unref). Also implements the "stalled >120s" threshold.
   */
  private startHeartbeatPoll(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.lastActivityAt = Date.now()
    this.heartbeatTimer = setInterval(() => {
      if (!this.isRunning()) return
      if (!isPidAlive(this.record.pid)) {
        logEvent('tengu_bg_worker_vanished', { short: this.config.short, pid: String(this.record.pid) })
        this.onChildExit(0, undefined)
        return
      }
      // ant 4706.js stall watchdog: pid is alive but no ring activity
      // for >120s → log once. Doesn't auto-respawn (ant treats this as
      // "the worker may be legitimately idle waiting for input"; user
      // can ccb stop + spawn fresh if needed).
      const silentMs = Date.now() - this.lastActivityAt
      if (silentMs > STALLED_THRESHOLD_MS && this.stalledFiredAt === 0) {
        this.stalledFiredAt = Date.now()
        logEvent('tengu_bg_worker_stalled', {
          short: this.config.short,
          pid: String(this.record.pid),
          silent_ms: String(silentMs),
          attachers: String(this.attachers.size),
        })
      }
    }, HEARTBEAT_POLL_MS)
    this.heartbeatTimer.unref()
  }

  /** Tag for incoming heartbeat from the worker (resets stall timer). */
  noteHeartbeat(): void {
    // Currently a no-op until ring-streaming wiring lands. Caller is
    // worker → daemon RPC; reserved for that path in #17.
  }

  /**
   * Called when the child process exits. Runs fast-crash detection
   * and either schedules respawn or settles the worker.
   */
  onChildExit(exitCode: number, signal?: NodeJS.Signals): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    const uptime = Date.now() - this.record.startedAt
    logEvent('tengu_bg_worker_exit', {
      short: this.config.short,
      pid: String(this.record.pid),
      exit_code: String(exitCode),
      signal: signal ?? '',
      uptime_ms: String(uptime),
    })
    if (this.isKilling()) {
      this.settle('killed')
      return
    }
    if (signal === 'SIGTERM' || signal === 'SIGKILL') {
      // Graceful or forced shutdown; not a crash.
      this.settle(exitCode === 0 ? 'done' : 'killed')
      return
    }
    if (exitCode === 0) {
      this.settle('done')
      return
    }
    // Non-zero exit. Fast-crash check.
    if (uptime < FAST_CRASH_WINDOW_MS) {
      this.fastCrashStreak++
      if (this.fastCrashStreak >= FAST_CRASH_LIMIT) {
        logEvent('tengu_bg_respawn_exhausted', { short: this.config.short, reason: 'fast_crash', streak: String(this.fastCrashStreak) })
        this.settle('crashed')
        return
      }
    } else {
      this.fastCrashStreak = 0
    }
    if (this.attempt >= MAX_RESPAWN_ATTEMPTS) {
      logEvent('tengu_bg_respawn_exhausted', { short: this.config.short, reason: 'max_attempts', attempts: String(this.attempt) })
      this.settle('crashed')
      return
    }
    // Schedule respawn with backoff.
    this.attempt++
    this.phase = { kind: 'spawning', attempt: this.attempt }
    if (this.backoffTimer) clearTimeout(this.backoffTimer)
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null
      this.spawn()
    }, RESPAWN_BACKOFF_MS)
    this.backoffTimer.unref()
    this.emit('respawn-scheduled', this.attempt)
  }

  /**
   * Initiate kill. `reason='grace'` waits for the worker to exit
   * naturally; `reason='reap'` SIGKILLs immediately; `reason='stop'`
   * detaches without signaling (used when client wants to leave the
   * worker running but daemon should forget about it).
   */
  kill(reason: 'grace' | 'reap' | 'stop'): void {
    if (this.phase.kind === 'retired') {
      logEvent('tengu_bg_phase_illegal', { short: this.config.short, op: 'kill', current: 'retired', requested: reason })
      return
    }
    this.phase = { kind: 'retiring', reason }
    logEvent('tengu_bg_retired', { short: this.config.short, reason })
    if (reason === 'stop') {
      // Just detach; let the worker keep running (it'll be re-adopted
      // next time the daemon starts).
      return
    }
    const sig: NodeJS.Signals = reason === 'reap' ? 'SIGKILL' : 'SIGTERM'
    try {
      process.kill(-this.record.pid, sig)
    } catch {
      try {
        process.kill(this.record.pid, sig)
      } catch {
        // Already gone.
      }
    }
    if (reason === 'grace') {
      // Escalate to SIGKILL after 5s if SIGTERM didn't take.
      setTimeout(() => {
        if (this.phase.kind === 'retiring' && this.phase.reason === 'grace') {
          logEvent('tengu_bg_dispatch_sigkill_escalate', {
            short: this.config.short,
            pid: String(this.record.pid),
          })
          try {
            process.kill(-this.record.pid, 'SIGKILL')
          } catch {
            try {
              process.kill(this.record.pid, 'SIGKILL')
            } catch {
              // best-effort
            }
          }
        }
      }, 5000).unref()
    }
  }

  /**
   * Mark the worker terminal. Caller is responsible for removing
   * this WorkerVm from the registry's `Map<short, WorkerVm>`.
   */
  private settle(outcome: SettleOutcome): void {
    if (this.settled) {
      logEvent('tengu_bg_phase_illegal', { short: this.config.short, op: 'settle', current: this.settled, requested: outcome })
      return
    }
    this.settled = outcome
    this.phase = { kind: 'retired', outcome }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer)
      this.backoffTimer = null
    }
    const finalStatus =
      outcome === 'done'
        ? 'exited'
        : outcome === 'crashed'
          ? 'exited'
          : 'killed'
    this.record = {
      ...this.record,
      status: finalStatus as WorkerRecord['status'],
      exitedAt: Date.now(),
    }
    try {
      writeWorkerRecord(this.record)
    } catch {
      // best-effort
    }
    for (const a of this.attachers) {
      try {
        a.end?.()
      } catch {
        // best-effort
      }
    }
    this.attachers.clear()
    logEvent('tengu_bg_settle', { short: this.config.short, outcome, attempts: String(this.attempt) })
    this.emit('settled', outcome)
  }

  /**
   * Force-settle externally (used by daemon shutdown — kill all
   * workers + persist before daemon exits).
   */
  forceSettle(outcome: SettleOutcome = 'killed'): void {
    this.settle(outcome)
  }
}
