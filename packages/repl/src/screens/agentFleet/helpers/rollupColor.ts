/**
 * Roll up the strongest child status color into a parent row badge.
 *
 * Source:
 *   ys3 = { warning: 2, success: 1, inactive: 0 }   (5092.js, "child rank")
 *   hs3 = { error: 3, warning: 2, success: 1 }       (5092.js, "PR rank")
 *   YdK = { error: 2, warning: 1 }                   (5092.js, "job rank")
 *
 *   SdK (5092.js:420-428) → rollupJobColor — across all children with rank
 *   CdK (5092.js:437-445) → rollupChildColor — child-only rank
 *   myH (5092.js:430-432) → isFrameKind     — skip kind==="frame" children
 */

import type { FleetStatusSegment } from '@claude-code/agent/background/fleet/fleetTypes.js'

/** Source: ant YdK. */
const JOB_RANK: Record<string, number> = { error: 2, warning: 1 }

/** Source: ant ys3. */
const CHILD_RANK: Record<string, number> = { warning: 2, success: 1, inactive: 0 }

function rankOf(table: Record<string, number>, key: string | undefined): number {
  if (key === undefined) return 0
  const r = table[key]
  return r === undefined ? 0 : r
}

/**
 * Pick the strongest job color across the job's own color and its
 * children's rollup colors. Source: ant SdK.
 */
export function rollupJobColor(
  ownColor: string | undefined,
  childSegments: ReadonlyArray<{ color: string | undefined; row: { kind: string } }>,
): string | undefined {
  let pick = ownColor
  let rank = rankOf(JOB_RANK, ownColor)
  for (const seg of childSegments) {
    if (seg.color === undefined) continue
    if (seg.row.kind === 'frame') continue // myH
    const r = rankOf(JOB_RANK, seg.color)
    if (r > rank) {
      pick = seg.color
      rank = r
    }
  }
  return pick
}

/**
 * Pick the strongest color across child segments only. Source: ant CdK.
 */
export function rollupChildColor(
  childSegments: ReadonlyArray<{ color: string | undefined; row: { kind: string } }>,
): string | undefined {
  let pick: string | undefined
  let rank = -1
  for (const seg of childSegments) {
    if (seg.color === undefined) continue
    if (seg.row.kind === 'frame') continue
    const r = rankOf(CHILD_RANK, seg.color)
    if (r > rank) {
      pick = seg.color
      rank = r
    }
  }
  return pick
}

/**
 * Sort PR rollup segments highest-rank first.
 * Source: ant Es3 (5092.js:447-449).
 */
export function sortStatusSegments(
  segments: readonly FleetStatusSegment[],
): FleetStatusSegment[] {
  return [...segments].sort((a, b) => {
    const ar = a.sortRank === undefined ? 0 : a.sortRank
    const br = b.sortRank === undefined ? 0 : b.sortRank
    return br - ar
  })
}
