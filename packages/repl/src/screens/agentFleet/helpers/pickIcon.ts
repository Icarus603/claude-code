/**
 * Row icon picker. Source: ant pdK (5092.js:599-604).
 *
 *   isPinned && tempo !== "active" && presence === undefined → "∙"   (pinned-idle marker)
 *   presence === "busy" || "shell"                            → null  (no glyph — let row body show)
 *   isLoopJob(state)                                          → "✢"   (completed/done glyph; loop is "self-completing")
 *   default                                                    → "✻"   (steady in-progress glyph)
 *
 * The animated spinner is NOT picked here — that's a render-time concern.
 * `pickIcon` selects the *static* glyph; the row renderer overlays a
 * spinner frame when the row is in the active band.
 */

import type {
  FleetJobState,
  FleetPresence,
} from '@claude-code/agent/background/fleet/fleetTypes.js'
import { WAITING_GLYPH } from './glyphs.js'
import { getCompletedGlyph, getSteadyGlyph } from './spinnerFrames.js'
import { isLoopJob } from './loopJob.js'

/**
 * Source: ant pdK.
 *
 * @returns The static glyph for the row, or `null` when the row should
 *          render with no glyph (busy/shell presence — row body shows
 *          activity instead).
 */
export function pickIcon(
  state: FleetJobState,
  isPinned: boolean,
  presence: FleetPresence,
): string | null {
  if (isPinned && state.tempo !== 'active' && presence === undefined) {
    return WAITING_GLYPH
  }
  if (presence === 'busy' || presence === 'shell') return null
  if (isLoopJob(state)) return getCompletedGlyph()
  return getSteadyGlyph()
}
