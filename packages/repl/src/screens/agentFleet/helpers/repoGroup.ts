/**
 * Repo grouping helpers.
 *
 * Source:
 *   PR_ (5092.js:496-499) → spawnOrigin — strip .claude/worktrees/ suffix
 *   Hi8 (5092.js:501-503) → repoGroup    — basename(spawnOrigin)
 *   bdK (5092.js:505-507) → repoGroupLabel — pretty repo label
 *   WR  (called from bdK)  → repo basename (ccb's `path.basename` is fine)
 *   Dz  (called from Hi8)  → optional pretty-name resolver (workspace name)
 *
 * For ccb, we collapse Hi8/bdK into a single function since we don't have
 * a workspace pretty-name resolver — the basename IS the label.
 */

import { basename } from 'node:path'
import type { FleetJobState } from '@claude-code/agent/background/fleet/fleetTypes.js'

/**
 * If `cwd` is inside a `.claude/worktrees/<branch>/` subdir, return the
 * parent directory (the original repo root). Otherwise the cwd itself.
 *
 * Source: ant PR_.
 */
export function spawnOrigin(state: FleetJobState): string {
  if (state.originCwd) return state.originCwd
  const match = state.cwd.match(/^(.+?)[/\\]\.claude[/\\]worktrees[/\\]/)
  return match ? match[1] : state.cwd
}

/**
 * Group key — typically the spawn origin path. Used to bucket rows by
 * repo when the user picks "by repo" grouping in the filter bar.
 *
 * Source: ant Hi8.
 */
export function repoGroup(state: FleetJobState): string {
  return spawnOrigin(state)
}

/**
 * Pretty display label for a repo group header.
 *
 * Source: ant bdK = WR(H). For ccb we render the basename of the origin
 * path (`/path/to/myrepo` → `myrepo`); ant uses the same when no pretty
 * workspace name is available.
 */
export function repoGroupLabel(state: FleetJobState): string {
  return basename(spawnOrigin(state))
}
