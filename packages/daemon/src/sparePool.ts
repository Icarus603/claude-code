/**
 * Spare worker pool — daemon-side scaffolding for ant 4644.js spare flow.
 *
 * STATUS: scaffolding only. Full ant parity requires worker-side changes
 * (inner ccb boots in "spare wait" mode, listens on its PTY socket for a
 * claim message, then transitions to real session). That requires REPLView
 * to gate render on a claim signal — separate epic.
 *
 * What this module DOES (this iteration):
 * - Track at most one pre-spawned spare (matching ant's `EKH = { jobId,
 *   sessionId, cwd, ready }` single-slot design)
 * - Emit tengu_bg_spare_enable / spare_spawn / spare_claim / spare_claim_fail
 *   so dashboards exist when worker-side lands
 * - claimSpare() returns null today (always fall through to fresh spawn)
 *   so dispatch latency unchanged but telemetry is present
 *
 * What this module does NOT do:
 * - Pre-spawn a real worker process (needs worker-side spare-wait)
 * - Reuse a worker for a different cwd/intent (needs worker-side claim msg)
 *
 * Enable via `CLAUDE_CODE_BG_SPARE_POOL=1` env var. Default off.
 *
 * @dynamicRequire
 */

import { logEvent } from '@claude-code/local-observability'

interface SpareSlot {
  short: string
  cwd: string
  spawnedAt: number
}

let slot: SpareSlot | null = null
let enabled = false

export function isSparePoolEnabled(): boolean {
  return enabled
}

export function enableSparePool(): void {
  if (enabled) return
  enabled = true
  logEvent('tengu_bg_spare_enable', { max_spare: '1' })
}

/**
 * Try to claim the current spare for `cwd`. Returns the slot's `short` if
 * the cwd matches and no other claim is in-flight, else null with reason.
 *
 * Today returns null — full worker-side claim protocol pending. The
 * telemetry path is wired so the future worker-side wire-up "just works".
 */
export function claimSpare(cwd: string): { ok: false; reason: string } | { ok: true; short: string } {
  if (!enabled || !slot) {
    logEvent('tengu_bg_spare_claim_fail', { reason: 'no-spare' })
    return { ok: false, reason: 'no-spare' }
  }
  if (slot.cwd !== cwd) {
    logEvent('tengu_bg_spare_claim_fail', { reason: 'cwd-mismatch', spare_cwd: slot.cwd, want_cwd: cwd })
    return { ok: false, reason: 'cwd-mismatch' }
  }
  // Worker-side claim protocol not yet wired — fall through.
  logEvent('tengu_bg_spare_claim_fail', { reason: 'worker-side-not-wired' })
  return { ok: false, reason: 'worker-side-not-wired' }
}

/**
 * Mark a freshly-spawned worker as the current spare. Caller is the
 * daemon's pre-warm scheduler (not yet wired). Returns false if a spare
 * already exists (single-slot design).
 */
export function recordSpareSpawn(short: string, cwd: string): boolean {
  if (!enabled) return false
  if (slot) return false
  slot = { short, cwd, spawnedAt: Date.now() }
  logEvent('tengu_bg_spare_spawn', { short, cwd })
  return true
}

/** Drop the recorded spare (e.g. on shutdown or after successful claim). */
export function clearSpare(): void {
  if (slot) {
    logEvent('tengu_bg_spare_claim', { short: slot.short, age_ms: String(Date.now() - slot.spawnedAt) })
    slot = null
  }
}

/** Test helper. */
export function _resetSparePoolForTest(): void {
  slot = null
  enabled = false
}
