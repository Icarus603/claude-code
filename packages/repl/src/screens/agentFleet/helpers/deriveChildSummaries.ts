/**
 * Map per-row `state.children` + PR cache → display summaries.
 *
 * Source: ant `GBK(children, M)` (5092.js inside the BdK row render).
 * For each child:
 *   - kind="agent": look up PR status from cache. The cache key is `href`.
 *     If PR status present, derive color via childStatusColor. The color
 *     drives the dot glyph rendered by FleetJobRow's ChildRollup.
 *   - kind="frame": always passes through with color undefined; ChildRollup
 *     paints it as the "claude" frame glyph (◐).
 */

import type {
  FleetChildSummary,
  FleetPrCache,
} from '@claude-code/agent/background/fleet/fleetTypes.js'
import type { FleetRowChildSummary } from '../components/FleetJobRow.js'
import { childStatusColor } from './childStatusColor.js'

const PR_COLOR_TO_THEME: Record<
  'error' | 'warning' | 'success',
  keyof import('@anthropic/ink').Theme
> = {
  error: 'error',
  warning: 'warning',
  success: 'success',
}

export function deriveChildSummaries(
  children: readonly FleetChildSummary[] | null,
  prCache: FleetPrCache | undefined,
): FleetRowChildSummary[] {
  if (children === null || children.length === 0) return []
  const out: FleetRowChildSummary[] = []
  for (const c of children) {
    if (c.kind === 'frame') {
      out.push({ kind: 'frame', href: c.href })
      continue
    }
    // kind === 'agent' → PR rollup if present.
    const pr = prCache?.get(c.href)
    if (pr === undefined) {
      out.push({ kind: 'agent', href: c.href })
      continue
    }
    const status = childStatusColor(pr)
    out.push({
      kind: 'agent',
      href: c.href,
      color: status === undefined ? undefined : PR_COLOR_TO_THEME[status],
    })
  }
  return out
}
