/**
 * Build the peek-panel child rows from `state.children` + PR cache.
 *
 * Source: ant 5092.js JdK (verbatim port):
 *
 *   function JdK(H, _) {
 *     return Es3(H.map(q => {
 *       if (q.kind === "frame") return {
 *         row: q, label: q.id, status: [], diffStat: void 0,
 *         color: "claude", sortRank: 0
 *       };
 *       let K = _.get(q.href);
 *       let O = K ? M$6(K) : void 0;
 *       return {
 *         row: q,
 *         label: K ? `#${K.number} ${K.title}` : `#${q.id}`,
 *         status: K ? IdK(K) : [],
 *         diffStat: K && K.state !== "MERGED" && K.state !== "CLOSED"
 *                   ? {additions: K.additions, deletions: K.deletions}
 *                   : void 0,
 *         color: K ? $i8(K) : void 0,
 *         sortRank: K?.state === "OPEN" && O ? hs3[O] ?? 0 : 0
 *       };
 *     }));
 *   }
 *
 *   Es3 = sort by sortRank desc.
 *   hs3 = {error: 3, warning: 2, success: 1}.
 *   $i8 = M$6 with "error" → "warning" demotion.
 *
 *   IdK (5091.js) builds the status badge array:
 *     MERGED → [{text: "merged", color: "merged"}]
 *     CLOSED → [{text: "closed", color: "inactive"}]
 *     OPEN:
 *       checks.failed > 0  → "✗ N/T" (error)
 *       checks.pending > 0 → "P/T"   (warning)
 *       checks.passed > 0  → "✓"     (success)
 *       review APPROVED            → "approved"            (success)
 *       review CHANGES_REQUESTED   → "✗"                   (error)
 *       review REVIEW_REQUIRED     → "needs review"        (no color)
 *     fallback when empty: state.toLowerCase() with $i8 color
 */

import figures from 'figures'
import type {
  FleetChildSummary,
  FleetPrCache,
  FleetPrSummary,
} from '@claude-code/agent/background/fleet/fleetTypes.js'
import type { Theme } from '@anthropic/ink'

/** Source: ant `IdK` status badge entry. */
export interface PeekChildStatusBadge {
  text: string
  color?: keyof Theme
}

/** Source: ant JdK row shape. */
export interface PeekChildRow {
  row: FleetChildSummary
  /** Source: ant `label`. */
  label: string
  /** Source: ant `status` — array of badges to render after the label. */
  status: PeekChildStatusBadge[]
  /** Source: ant `diffStat` — additions/deletions for open PRs. */
  diffStat?: { additions: number; deletions: number }
  /** Source: ant `color` from $i8($i8 = M$6 with error→warning). */
  color?: keyof Theme
  /** Source: ant `sortRank` — drives Es3 sort. */
  sortRank: number
}

/** Source: ant 5092.js `M$6`. */
function prClassification(
  pr: FleetPrSummary,
): 'merged' | 'inactive' | 'error' | 'success' | 'warning' | undefined {
  switch (pr.state) {
    case 'MERGED':
      return 'merged'
    case 'CLOSED':
    case 'DRAFT':
      return 'inactive'
    case 'OPEN':
      if (pr.checks.failed > 0 || pr.review === 'CHANGES_REQUESTED')
        return 'error'
      if (pr.checks.pending === 0 && pr.review !== 'REVIEW_REQUIRED')
        return 'success'
      return 'warning'
    default:
      return undefined
  }
}

/** Source: ant 5092.js `$i8` — M$6 with error→warning demotion. */
function prRollupColor(pr: FleetPrSummary): keyof Theme | undefined {
  const c = prClassification(pr)
  if (c === 'error') return 'warning'
  if (c === 'merged' || c === 'inactive') return c as keyof Theme | undefined
  return c as keyof Theme | undefined
}

/** Source: ant 5091.js `IdK`. */
function buildStatusBadges(pr: FleetPrSummary): PeekChildStatusBadge[] {
  if (pr.state === 'MERGED')
    return [{ text: 'merged', color: 'merged' as keyof Theme }]
  if (pr.state === 'CLOSED')
    return [{ text: 'closed', color: 'inactive' as keyof Theme }]
  const out: PeekChildStatusBadge[] = []
  const failed = pr.checks.failed
  const pending = pr.checks.pending
  const passed = pr.checks.passed
  const total = failed + pending + passed
  if (failed > 0) {
    out.push({ text: `${figures.cross} ${failed}/${total}`, color: 'error' })
  } else if (pending > 0) {
    out.push({ text: `${passed}/${total}`, color: 'warning' })
  } else if (total > 0) {
    out.push({ text: figures.tick, color: 'success' })
  }
  switch (pr.review) {
    case 'APPROVED':
      out.push({ text: 'approved', color: 'success' })
      break
    case 'CHANGES_REQUESTED':
      out.push({ text: figures.cross, color: 'error' })
      break
    case 'REVIEW_REQUIRED':
      out.push({ text: 'needs review', color: undefined })
      break
    case null:
    case 'COMMENTED':
    case undefined:
      break
  }
  if (out.length === 0) {
    out.push({ text: pr.state.toLowerCase(), color: prRollupColor(pr) })
  }
  return out
}

/** Source: ant 5093.js `hs3`. */
const SORT_RANK: Record<string, number> = { error: 3, warning: 2, success: 1 }

/** Source: ant JdK + Es3. */
export function derivePeekChildRows(
  children: readonly FleetChildSummary[],
  prCache: FleetPrCache | undefined,
): PeekChildRow[] {
  const rows: PeekChildRow[] = []
  for (const child of children) {
    if (child.kind === 'frame') {
      rows.push({
        row: child,
        label: child.id ?? child.href,
        status: [],
        diffStat: undefined,
        color: 'claude' as keyof Theme,
        sortRank: 0,
      })
      continue
    }
    const pr = prCache?.get(child.href)
    const classification = pr ? prClassification(pr) : undefined
    rows.push({
      row: child,
      label:
        pr?.number !== undefined
          ? `#${pr.number} ${pr.title ?? ''}`.trim()
          : `#${child.id ?? child.href}`,
      status: pr ? buildStatusBadges(pr) : [],
      diffStat:
        pr &&
        pr.state !== 'MERGED' &&
        pr.state !== 'CLOSED' &&
        pr.additions !== undefined &&
        pr.deletions !== undefined
          ? { additions: pr.additions, deletions: pr.deletions }
          : undefined,
      color: pr ? prRollupColor(pr) : undefined,
      sortRank:
        pr?.state === 'OPEN' && classification !== undefined
          ? (SORT_RANK[classification] ?? 0)
          : 0,
    })
  }
  // Source: ant Es3 = sort by sortRank desc.
  return rows.sort((a, b) => b.sortRank - a.sortRank)
}
