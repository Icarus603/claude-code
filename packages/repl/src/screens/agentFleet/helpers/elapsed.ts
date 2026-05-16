/**
 * Format a job's age / next-scheduled-time as a short, single-unit string.
 *
 * Source: ant Ds3 (5092.js:54-56) + _i8 (5092.js:57-61).
 *
 *   formatJobAge(job, nextAt):
 *     if nextAt && nextAt > now → "in 3m" / "in 2h" / etc.
 *     else                       → "42s" / "14m" / "2h" (since createdAt)
 */

import { formatDuration } from '@claude-code/output/formatters/format.js'
import type { FleetJob } from '@claude-code/agent/background/fleet/fleetTypes.js'

/** Source: ant Ds3. */
export function jobAge(state: { createdAt: string }): string {
  const ms = Math.max(0, Date.now() - Date.parse(state.createdAt))
  return formatDuration(ms, { mostSignificantOnly: true })
}

/** Source: ant _i8. */
export function formatJobAge(job: FleetJob, nextAt?: number | null): string {
  const now = Date.now()
  if (nextAt != null && nextAt > now) {
    return `in ${formatDuration(nextAt - now, { mostSignificantOnly: true })}`
  }
  return jobAge(job.state)
}
