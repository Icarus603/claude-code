/**
 * Predicates that match a job against an active filter token.
 *
 * Source:
 *   in8 (5092.js:230-235) → jobMatchesPr
 *   rn8 (5092.js:240-245) → jobMatchesFrame
 *   WZ6 (5092.js:236-239) → jobMatchesCwd
 */

import { relative as relativePath, isAbsolute } from 'node:path'
import type { FleetJobState } from '@claude-code/agent/background/fleet/fleetTypes.js'
import { buildPrRefRegex, parseFrameRef } from './parseQuery.js'
import { spawnOrigin } from './repoGroup.js'

/**
 * Match `state` against a PR number — either via child id or by URL
 * regex hit on any of state.output strings. Source: ant in8.
 */
export function jobMatchesPr(
  state: FleetJobState,
  prNumber: string,
  precompiledRe?: RegExp,
): boolean {
  const re = precompiledRe ?? buildPrRefRegex(prNumber)
  const childHit = state.children?.some(c => c.id === prNumber || re.test(c.href)) ?? false
  if (childHit) return true
  const outputs = state.output ? Object.values(state.output) : []
  return outputs.some(o => re.test(o))
}

/**
 * Match `state` against a frame ref. ant rn8 looks at children of kind
 * "frame" AND scans output for the bare `frame-<id>` token. Source: ant rn8.
 */
export function jobMatchesFrame(state: FleetJobState, frameId: string): boolean {
  const childHit =
    state.children?.some(c => c.kind === 'frame' && parseFrameRef(c.href) === frameId) ?? false
  if (childHit) return true
  const outputs = state.output ? Object.values(state.output) : []
  return outputs.some(o =>
    o.split(/\s+/).some(tok => parseFrameRef(tok) === frameId),
  )
}

/**
 * Match a job to a cwd subtree — true when the job's `spawnOrigin`
 * is `cwd` or a descendant. Source: ant WZ6.
 */
export function jobMatchesCwd(state: FleetJobState, cwd: string): boolean {
  const origin = spawnOrigin(state)
  const rel = relativePath(cwd, origin)
  const first = rel.split(/[/\\]/, 1)[0]
  return first !== '..' && !isAbsolute(rel)
}
