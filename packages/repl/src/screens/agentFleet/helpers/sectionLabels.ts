/**
 * Section bucket labels + priority order.
 *
 * Source: ant 5093.js:106-112.
 *
 *   $dK = ["review", "blocked", "working", "done"]
 *   zdK = {
 *     review:  "Ready for review",
 *     blocked: "Needs input",
 *     working: "Working",
 *     done:    "Completed",
 *   }
 *
 * Banner triplet `N awaiting input · N working · M completed` collapses
 * the review bucket into "working" for the count (ant 5092.js:3245-3256
 * picks counts from `eG` filtered by uyH band, not bucket).
 */

import type { FleetBucket } from '@claude-code/agent/background/fleet/fleetTypes.js'

/** Render order — top section first. Source: ant $dK. */
export const FLEET_BUCKET_ORDER: readonly FleetBucket[] = [
  'review',
  'blocked',
  'working',
  'done',
] as const

/** Visible section header labels. Source: ant zdK. */
export const FLEET_BUCKET_LABEL: Readonly<Record<FleetBucket, string>> = {
  review: 'Ready for review',
  blocked: 'Needs input',
  working: 'Working',
  done: 'Completed',
} as const
