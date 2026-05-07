/**
 * Spare worker pool — full ant 4644.js port.
 *
 * Single-slot design: at most one pre-warmed spare worker per daemon.
 * On `dispatch`, try claim → send 'claim' ctrl-frame to the spare's PTY
 * socket carrying the user's intent → re-write its state.json with the
 * real intent + cwd. If claim fails, fall through to fresh spawn.
 *
 * Pre-warm scheduler runs on daemon idle (no pending dispatches in
 * flight): spawns a spare with `--bg-pty -- bg` template + placeholder
 * sessionId, marks `EKH = { jobId, sessionId, cwd, ready: false }`.
 *
 * Gate: CLAUDE_CODE_BG_SPARE_POOL=1 (default OFF — saves user's idle
 * resources unless they opt in).
 *
 * @dynamicRequire
 */

import { logEvent } from '@claude-code/local-observability'

interface SpareSlot {
  short: string
  cwd: string
  sessionId: string
  ptySocket: string
  spawnedAt: number
  ready: boolean
}

let slot: SpareSlot | null = null
let enabled = false
let prewarmInFlight = false

export function isSparePoolEnabled(): boolean {
  return enabled
}

export function enableSparePool(): void {
  if (enabled) return
  enabled = true
  logEvent('tengu_bg_spare_enable', { max_spare: '1' })
}

/**
 * Returns the current spare slot snapshot (or null). Used by daemon
 * dispatch to decide claim vs fresh spawn.
 */
export function getSpareSlot(): SpareSlot | null {
  return slot ? { ...slot } : null
}

/**
 * Try to claim the current spare for `cwd`. Returns the slot's
 * `short` if cwd matches and slot is ready, else { ok:false, reason }.
 *
 * On successful claim: clear slot (single-slot design — claim consumes
 * the spare; pre-warm scheduler will spawn the next on idle).
 *
 * The actual ctrl-frame send is done by the daemon's `sendclaim` op
 * after this returns ok — this fn just reserves the slot.
 */
export function claimSpare(cwd: string): { ok: false; reason: string } | { ok: true; short: string; sessionId: string; ptySocket: string } {
  if (!enabled || !slot) {
    logEvent('tengu_bg_spare_claim_fail', { reason: 'no-spare' })
    return { ok: false, reason: 'no-spare' }
  }
  if (!slot.ready) {
    logEvent('tengu_bg_spare_claim_fail', { reason: 'not-ready', short: slot.short })
    return { ok: false, reason: 'not-ready' }
  }
  if (slot.cwd !== cwd) {
    logEvent('tengu_bg_spare_claim_fail', { reason: 'cwd-mismatch', spare_cwd: slot.cwd, want_cwd: cwd })
    return { ok: false, reason: 'cwd-mismatch' }
  }
  const claimed = { short: slot.short, sessionId: slot.sessionId, ptySocket: slot.ptySocket }
  logEvent('tengu_bg_spare_claim', { short: slot.short, age_ms: String(Date.now() - slot.spawnedAt) })
  slot = null
  return { ok: true, ...claimed }
}

/**
 * Mark a freshly-spawned spare worker as the current slot. Caller is
 * the daemon's pre-warm scheduler. Returns false if a spare already
 * exists.
 */
export function recordSpareSpawn(short: string, cwd: string, sessionId: string, ptySocket: string): boolean {
  if (!enabled) return false
  if (slot) return false
  slot = { short, cwd, sessionId, ptySocket, spawnedAt: Date.now(), ready: false }
  logEvent('tengu_bg_spare_spawn', { short, cwd, sessionId })
  return true
}

/**
 * Mark the spare ready (called when worker's first 'hello' ctrl-frame
 * comes back, indicating REPL is bootstrapped and waiting). Until ready,
 * claim returns 'not-ready' so we don't race against an unbooted worker.
 */
export function markSpareReady(short: string): void {
  if (slot && slot.short === short) {
    slot.ready = true
  }
}

/** Drop the recorded spare without claim (e.g. on shutdown). */
export function clearSpare(): void {
  slot = null
}

/**
 * Pre-warm scheduler tick — call from daemon idle loop (e.g. every 30s).
 * Returns whether a spare should be spawned now.
 */
export function shouldPrewarm(): boolean {
  return enabled && !slot && !prewarmInFlight
}

export function setPrewarmInFlight(v: boolean): void {
  prewarmInFlight = v
}

/** Test helper. */
export function _resetSparePoolForTest(): void {
  slot = null
  enabled = false
  prewarmInFlight = false
}
