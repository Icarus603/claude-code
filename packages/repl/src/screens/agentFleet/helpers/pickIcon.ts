/**
 * Row icon picker. Source: ant pdK (5092.js):
 *
 *   function pdK(H, _, q) {
 *     if (_ && H.tempo !== "active" && q === void 0) return sq_;  // "∙"
 *     if (q === "busy" || q === "shell") return null;             // → spinner
 *     if (WR_(H)) return Ns3();                                   // "✢"
 *     return Vs3();                                               // "✻"
 *   }
 *
 * Call site: `P = ... pdK(q.state, X, $)` where X = `bZH(q.state.state)` —
 * the TERMINAL OUTCOME (null when state.state is working/blocked,
 * "success"/"failure"/"stopped" when terminal). Param 2 is OUTCOME, NOT
 * isPinned. ccb's earlier port misread this and used isPinned, which made:
 *   - completed rows render "✻" (the working glyph) instead of the
 *     pinned-style "∙" terminal indicator the user expects;
 *   - pinned-but-still-working rows wrongly render "∙".
 *
 * Terminal + idle + no presence  → "∙" (small bullet, ant sq_ U+2219)
 * presence === "busy" || "shell" → null  (caller renders animated <FleetSpinner/>)
 * loop job                       → "✢" (Ns3, completed glyph)
 * default                        → "✻" (Vs3, steady glyph)
 *
 * The animated spinner is NOT picked here — that's a render-time concern.
 * Returning null tells the row renderer to mount the animated component.
 */

import type {
  FleetJobState,
  FleetPresence,
} from '@claude-code/agent/background/fleet/fleetTypes.js'
import { WAITING_GLYPH } from './glyphs.js'
import { getCompletedGlyph, getSteadyGlyph } from './spinnerFrames.js'
import { isLoopJob } from './loopJob.js'
import { stateOutcome, type FleetOutcome } from './stateOutcome.js'

/**
 * Source: ant pdK. Verbatim semantics.
 *
 * @param state     FleetJobState (`q.state` in ant).
 * @param outcome   `bZH(state.state)` — terminal outcome or null.
 * @param presence  Worker presence reported by the daemon roster.
 * @returns The static glyph for the row, or `null` when the row should
 *          render with an animated spinner (busy/shell presence).
 */
export function pickIcon(
  state: FleetJobState,
  outcome: FleetOutcome | null,
  presence: FleetPresence,
): string | null {
  if (outcome !== null && state.tempo !== 'active' && presence === undefined) {
    return WAITING_GLYPH
  }
  if (presence === 'busy' || presence === 'shell') return null
  if (isLoopJob(state)) return getCompletedGlyph()
  return getSteadyGlyph()
}

// Re-export for callers that want to pass `state.state` directly.
export { stateOutcome }
