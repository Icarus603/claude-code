/**
 * LoopDynamic core — port of upstream v2.1.123 (resplit/2551.js).
 *
 * `scheduleLoopWakeup(delaySeconds, prompt, reason)` is the only function
 * ScheduleWakeupTool calls. Each call:
 *   1. Cancels any existing session crons with the same `prompt` (so the
 *      model can re-pace freely without piling up dupes).
 *   2. Tracks per-prompt loop age in STATE.loopChainStartedAt so loops
 *      can't run forever — at recurringMaxAgeMs (default 7 days) we
 *      refuse and emit a telemetry event so the model knows to stop.
 *   3. Clamps delay to [60, 3600] s, aligns target time to the next
 *      whole minute, and adjusts away from the 5-minute mark to keep
 *      the prompt cache pre-warm window healthy.
 *   4. Generates a 5-field cron expression matching the target minute
 *      and adds a session-only cron task with `kind: 'loop'`.
 *
 * `cancelAllPendingLoopSessionCrons()` is invoked from the abort path so
 * an interrupted loop doesn't keep firing after the user kills the turn.
 */

import { logEvent } from '@claude-code/local-observability'
import {
  addSessionCronTask,
  deleteLoopChainStartedAt,
  getLoopChainStartedAt,
  getSessionCronTasks,
  removeSessionCronTasks,
  setLoopChainStartedAt,
  setScheduledTasksEnabled,
} from '@claude-code/app-host/bootstrap/state.js'
import { getCronJitterConfig } from '../misc/cronJitterConfig.js'

export const MIN_LOOP_DELAY_SECONDS = 60
export const MAX_LOOP_DELAY_SECONDS = 3600
const FIVE_MINUTES_MS = 5 * 60 * 1000

export type ScheduleResult = {
  scheduledFor: number
  clampedDelaySeconds: number
  wasClamped: boolean
}

/**
 * Round a Date forward to the next whole minute. Used so the cron string
 * we generate matches the wakeup time the user expects.
 */
function alignToNextMinute(targetMs: number): number {
  const d = new Date(targetMs)
  if (d.getSeconds() > 0 || d.getMilliseconds() > 0) {
    d.setMinutes(d.getMinutes() + 1)
  }
  d.setSeconds(0, 0)
  return d.getTime()
}

/**
 * Compute the actual wakeup time. Identical algorithm to upstream VS1():
 *   - clamp delaySeconds to [60, 3600]
 *   - target = now + clamped*1000
 *   - align to next whole minute
 *   - if cacheLeadMs > 0 and we're still within the 5-minute cache window,
 *     pull the target back one minute at a time until we leave the lead
 *     zone (but don't drop below the 60s floor). This keeps us from
 *     scheduling at exactly cache-expiry, where every wake pays a fresh
 *     cache miss.
 */
function computeWakeupTarget(delaySeconds: number): {
  clamped: number
  wasClamped: boolean
  targetMs: number
  createdAt: number
  target: Date
} {
  let raw: number
  if (Number.isNaN(delaySeconds)) {
    raw = MIN_LOOP_DELAY_SECONDS
  } else if (delaySeconds === Infinity) {
    raw = MAX_LOOP_DELAY_SECONDS
  } else if (delaySeconds === -Infinity) {
    raw = MIN_LOOP_DELAY_SECONDS
  } else {
    raw = Math.round(delaySeconds)
  }
  const clamped = Math.max(
    MIN_LOOP_DELAY_SECONDS,
    Math.min(MAX_LOOP_DELAY_SECONDS, raw),
  )
  const wasClamped = !Number.isFinite(delaySeconds) || raw !== clamped
  const now = Date.now()
  const naiveTargetMs = now + clamped * 1000
  let alignedMs = alignToNextMinute(naiveTargetMs)
  const cacheLeadMs = getCronJitterConfig().cacheLeadMs ?? 0
  if (cacheLeadMs > 0 && clamped * 1000 <= FIVE_MINUTES_MS) {
    const safeWindow = FIVE_MINUTES_MS - cacheLeadMs
    while (
      alignedMs - now > safeWindow &&
      alignedMs - 60_000 >= now + MIN_LOOP_DELAY_SECONDS * 1000
    ) {
      alignedMs -= 60_000
    }
  }
  const target = new Date(alignedMs)
  // createdAt: just before the aligned target so the cron tick recognises
  // this as a fresh, never-fired task on its first sweep.
  const createdAt = naiveTargetMs < alignedMs ? naiveTargetMs : alignedMs - 1
  return {
    clamped,
    wasClamped,
    targetMs: alignedMs,
    createdAt,
    target,
  }
}

function makeLoopShortId(): string {
  return Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0')
}

/**
 * Cancel any existing loop crons with the same prompt. The cron scheduler
 * doesn't support edit-in-place, so re-scheduling means cancel + re-add.
 */
function cancelLoopCronsForPrompt(prompt: string): void {
  const existing = getSessionCronTasks()
    .filter(t => t.kind === 'loop' && t.prompt === prompt)
    .map(t => t.id)
  if (existing.length > 0) removeSessionCronTasks(existing)
}

export function scheduleLoopWakeup(
  delaySeconds: number,
  prompt: string,
  reason: string | undefined,
): ScheduleResult | null {
  cancelLoopCronsForPrompt(prompt)

  const now = Date.now()
  const existing = getLoopChainStartedAt(prompt)
  // If the chain has been silent past MAX_LOOP_DELAY_SECONDS, treat it as
  // a fresh start. Otherwise carry over the original startedAt so the
  // age cap is honoured across reschedules.
  const isStaleChain =
    existing !== undefined &&
    now > existing.lastScheduledFor + MAX_LOOP_DELAY_SECONDS * 1000
  const startedAt =
    existing === undefined || isStaleChain ? now : existing.startedAt

  const { recurringMaxAgeMs } = getCronJitterConfig()
  if (recurringMaxAgeMs > 0 && now - startedAt >= recurringMaxAgeMs) {
    if (!existing?.agedOut) {
      setLoopChainStartedAt(prompt, {
        startedAt,
        lastScheduledFor:
          now - (MAX_LOOP_DELAY_SECONDS - MIN_LOOP_DELAY_SECONDS) * 1000,
        agedOut: true,
      })
      logEvent('tengu_loop_dynamic_wakeup_aged_out', {
        loop_age_ms: now - startedAt,
        max_age_ms: recurringMaxAgeMs,
      })
    }
    return null
  }

  const { clamped, wasClamped, targetMs, createdAt, target } =
    computeWakeupTarget(delaySeconds)
  const cron = `${target.getMinutes()} ${target.getHours()} * * *`

  addSessionCronTask({
    id: makeLoopShortId(),
    cron,
    prompt,
    createdAt,
    kind: 'loop',
  })
  setLoopChainStartedAt(prompt, { startedAt, lastScheduledFor: targetMs })
  setScheduledTasksEnabled(true)

  logEvent('tengu_loop_dynamic_wakeup_scheduled', {
    chosen_delay_seconds: Number.isFinite(delaySeconds) ? delaySeconds : 0,
    clamped_delay_seconds: clamped,
    was_clamped: wasClamped,
    reason: reason !== undefined ? reason.slice(0, 200) : undefined,
  })

  return {
    scheduledFor: targetMs,
    clampedDelaySeconds: clamped,
    wasClamped,
  }
}

/**
 * Drop every pending session cron with `kind: 'loop'`. Wired into the
 * abort path so a cancelled turn doesn't keep firing the loop. Also
 * clears the loopChainStartedAt entries so a re-armed loop starts fresh.
 */
export function cancelAllPendingLoopSessionCrons(): number {
  const loopCrons = getSessionCronTasks().filter(t => t.kind === 'loop')
  if (loopCrons.length === 0) return 0
  removeSessionCronTasks(loopCrons.map(t => t.id))
  for (const t of loopCrons) deleteLoopChainStartedAt(t.prompt)
  return loopCrons.length
}

export function isLoopDynamicEnabled(): boolean {
  // Imported lazily to avoid a top-level dep on feature-flags from the
  // agent package's barrel — feature-flags pulls in growthbook + zod
  // schemas that are heavyweight relative to this module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getFeatureValue_CACHED_MAY_BE_STALE } = require(
    '@claude-code/config/feature-flags',
  ) as typeof import('@claude-code/config/feature-flags')
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_kairos_loop_dynamic',
    false,
  )
}
