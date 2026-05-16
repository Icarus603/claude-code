/**
 * Derives the visible row list from job state + filter + group + sort.
 *
 * Source: ant 5092.js section-row builder (around lines 2300-2450 — the
 * `cH` derivation pipeline). The returned array is the flat visible-row
 * model consumed by the renderer:
 *
 *   row.kind === 'header' → section header (count badge when collapsed)
 *   row.kind === 'job'    → individual FleetJob row
 *   row.kind === 'fold'   → "+N more" row at the end of a folded section
 *
 * Filter pipeline (in order):
 *   1. `parseQuery(filterText)` → {template, state, output, pr, frame, text}
 *   2. drop rows that don't match all set predicates
 *   3. group by state bucket (`PZ6` → `Ready for review`/`Needs input`/...)
 *      OR by repo (when `groupMode === 'directory'`)
 *   4. within each group: sort by `effectiveStateSortOrder` desc
 *   5. apply `doneFoldCap` to the "done" bucket (collapses extra rows)
 */

import { useMemo } from 'react'

import type {
  FleetBucket,
  FleetJob,
  FleetPresence,
  FleetPrCache,
} from '@claude-code/agent/background/fleet/fleetTypes.js'

import { deriveActivity } from '../helpers/deriveActivity.js'
import { doneFoldCap } from '../helpers/doneFoldCap.js'
import { jobMatchesCwd, jobMatchesFrame, jobMatchesPr } from '../helpers/jobMatch.js'
import { jobLabel } from '../helpers/jobLabel.js'
import { type ParsedQuery, parseQuery } from '../helpers/parseQuery.js'
import { repoGroup } from '../helpers/repoGroup.js'
import { FLEET_BUCKET_LABEL, FLEET_BUCKET_ORDER } from '../helpers/sectionLabels.js'
import { effectiveStateSortOrder } from '../helpers/sortJobs.js'
import { stateBucket } from '../helpers/stateBucket.js'

export type FleetGroupMode = 'state' | 'directory'

export type FleetRow =
  | { kind: 'header'; group: string; label: string; hiddenCount: number; rowCount: number }
  | { kind: 'job'; group: string; job: FleetJob; activity: ReturnType<typeof deriveActivity> }
  | { kind: 'fold'; group: string; hidden: number }

export interface UseFleetRowsArgs {
  jobs: readonly FleetJob[]
  filterText: string
  groupMode: FleetGroupMode
  presence: Map<string, FleetPresence>
  prCache: FleetPrCache | undefined
  collapsedGroups: ReadonlySet<string>
  /** Foreground session id — separates "Pinned" pseudo-group anchor. */
  currentSessionId?: string
  /** When set, restrict to jobs whose spawnOrigin is inside this cwd. */
  scopedCwd?: string
}

export interface UseFleetRowsResult {
  rows: FleetRow[]
  /** Map of bucket → row count, used by the banner. */
  bucketCounts: Record<FleetBucket, number>
  /** Map of group → row count (post-filter), used by the section header. */
  groupCounts: Map<string, number>
}

function passesQuery(
  job: FleetJob,
  query: ParsedQuery,
  scopedCwd: string | undefined,
): boolean {
  const state = job.state

  if (query.template !== undefined && state.template.toLowerCase() !== query.template) {
    return false
  }
  if (query.state !== undefined) {
    if (FLEET_BUCKET_LABEL[query.state as FleetBucket] === undefined) return false
  }
  if (query.pr !== undefined && !jobMatchesPr(state, query.pr)) return false
  if (query.frame !== undefined && !jobMatchesFrame(state, query.frame)) return false
  if (query.output !== undefined) {
    const outputs = state.output ? Object.values(state.output) : []
    if (!outputs.some(o => o.toLowerCase().includes(query.output as string))) return false
  }
  if (query.text !== '') {
    const haystack = `${state.name ?? ''} ${state.intent} ${state.detail}`.toLowerCase()
    if (!haystack.includes(query.text)) return false
  }
  if (scopedCwd !== undefined && !jobMatchesCwd(state, scopedCwd)) return false
  return true
}

function pickGroupKey(
  bucket: FleetBucket,
  state: FleetJob['state'],
  groupMode: FleetGroupMode,
): string {
  if (state.pinned === true) return 'pinned'
  if (groupMode === 'directory') return repoGroup(state)
  return bucket
}

/** Source: ant `cH` visible-rows builder (5092.js cluster around 2300-2450). */
export function useFleetRows({
  jobs,
  filterText,
  groupMode,
  presence,
  prCache,
  collapsedGroups,
  currentSessionId,
  scopedCwd,
}: UseFleetRowsArgs): UseFleetRowsResult {
  return useMemo(() => {
    const query = parseQuery(filterText)

    // 1. Annotate each job with its derived bucket + group + activity.
    const annotated = jobs
      .filter(job => passesQuery(job, query, scopedCwd))
      .map(job => {
        const activity = deriveActivity(job.state, prCache)
        const bucket = stateBucket(
          { state: job.state, activity },
          prCache,
          presence.get(job.id),
        )
        const group = pickGroupKey(bucket, job.state, groupMode)
        return { job, activity, bucket, group }
      })

    // 2. Group annotated jobs by group key (pinned/bucket/repo).
    const grouped = new Map<string, typeof annotated>()
    for (const item of annotated) {
      const list = grouped.get(item.group)
      if (list === undefined) grouped.set(item.group, [item])
      else list.push(item)
    }

    // 3. Determine render order of groups.
    const groupOrder: string[] = []
    if (grouped.has('pinned')) groupOrder.push('pinned')
    if (groupMode === 'state') {
      for (const bucket of FLEET_BUCKET_ORDER) {
        if (grouped.has(bucket)) groupOrder.push(bucket)
      }
    } else {
      // directory mode: alphabetical, foreground repo (if known) first
      const repos = [...grouped.keys()].filter(k => k !== 'pinned').sort()
      for (const repo of repos) groupOrder.push(repo)
    }

    // 4. Build the flat row list.
    const rows: FleetRow[] = []
    const groupCounts = new Map<string, number>()
    for (const group of groupOrder) {
      const items = grouped.get(group) ?? []
      items.sort((a, b) => {
        // Foreground session always first inside its group.
        if (currentSessionId !== undefined) {
          const aFg = a.job.state.sessionId === currentSessionId ? -1 : 0
          const bFg = b.job.state.sessionId === currentSessionId ? -1 : 0
          if (aFg !== bFg) return aFg - bFg
        }
        const ab = effectiveStateSortOrder(
          a.job.state,
          (groupMode === 'state' ? group : a.bucket) as FleetBucket,
        )
        const bb = effectiveStateSortOrder(
          b.job.state,
          (groupMode === 'state' ? group : b.bucket) as FleetBucket,
        )
        return bb - ab
      })

      groupCounts.set(group, items.length)
      const collapsed = collapsedGroups.has(group)
      const label =
        group === 'pinned'
          ? 'Pinned'
          : groupMode === 'state'
            ? FLEET_BUCKET_LABEL[group as FleetBucket]
            : items[0] !== undefined
              ? repoGroup(items[0].job.state).split('/').pop() ?? group
              : group

      rows.push({
        kind: 'header',
        group,
        label,
        hiddenCount: collapsed ? items.length : 0,
        rowCount: items.length,
      })

      if (collapsed) continue

      const visible = group === 'done' ? items.slice(0, doneFoldCap(items.length)) : items
      for (const item of visible) {
        rows.push({ kind: 'job', group, job: item.job, activity: item.activity })
      }
      if (visible.length < items.length) {
        rows.push({ kind: 'fold', group, hidden: items.length - visible.length })
      }
    }

    // 5. Bucket counts for the banner.
    const bucketCounts: Record<FleetBucket, number> = {
      review: 0,
      blocked: 0,
      working: 0,
      done: 0,
    }
    for (const item of annotated) bucketCounts[item.bucket] += 1
    // `jobLabel` referenced here to keep import live for future row-label
    // pre-computation. No-op.
    void jobLabel

    return { rows, bucketCounts, groupCounts }
  }, [
    jobs,
    filterText,
    groupMode,
    presence,
    prCache,
    collapsedGroups,
    currentSessionId,
    scopedCwd,
  ])
}
