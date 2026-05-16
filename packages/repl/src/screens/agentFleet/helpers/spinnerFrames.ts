/**
 * FleetView spinner glyph frames.
 *
 * Source: ant 2464.js:4-11 + 5092.js:393-401.
 *
 *   ezH      → getSpinnerFrames()      — six base frames (or ghostty fallback)
 *   ks3()    → getSpinnerFramesCycle() — base + reversed, 12-frame ping-pong
 *   Vs3()    → STEADY_GLYPH            — ezH[4], "✻", used for sub-rows
 *   Ns3()    → COMPLETED_GLYPH         — ezH[1], "✢", used for done band
 *
 * The animated row picks a frame every 120 ms (ant Cs3 at 5092.js:605-613,
 * `Math.floor(now/120) % cycle.length`). Full cycle = 12 × 120 ms = 1.44 s.
 *
 * Ghostty (a popular terminal) renders the U+273D `✽` glyph as a tofu box,
 * so ant substitutes a plain `*` for the final frame when TERM matches.
 */

export const SPINNER_FRAME_MS = 120

/** Default frames (Unicode sparkles, U+00B7 → U+273D). */
const DEFAULT_FRAMES = ['·', '✢', '✳', '✶', '✻', '✽'] as const

/** Ghostty fallback (last frame swapped to ASCII asterisk). */
const GHOSTTY_FRAMES = ['·', '✢', '✳', '✶', '✻', '*'] as const

/**
 * Six-frame base palette. Re-evaluated only when TERM changes so that
 * a single live process renders consistently.
 *
 * Source: ant ezH = X6(() => ..., () => process.env.TERM).
 */
export function getSpinnerFrames(): readonly string[] {
  if (process.env.TERM === 'xterm-ghostty') return GHOSTTY_FRAMES
  return DEFAULT_FRAMES
}

/**
 * 12-frame ping-pong cycle (base frames forward, then reverse). Spinner
 * components advance through this array by `Math.floor(now/120) % 12`.
 *
 * Source: ant ks3 = () => [...H, ...[...H].reverse()].
 */
export function getSpinnerFramesCycle(): readonly string[] {
  const base = getSpinnerFrames()
  return [...base, ...[...base].reverse()]
}

/**
 * Steady non-animated glyph used for in-progress sub-rows (PR child rows,
 * frame child rows). Source: ant Vs3 = () => ezH[4] = "✻".
 */
export function getSteadyGlyph(): string {
  return getSpinnerFrames()[4]
}

/**
 * Completed glyph used for done-band rows. Source: ant Ns3 = () => ezH[1] = "✢".
 */
export function getCompletedGlyph(): string {
  return getSpinnerFrames()[1]
}

/**
 * Pick the current animated frame for a row at the given time.
 * Source: ant Cs3 (5092.js:605-613).
 */
export function pickSpinnerFrame(nowMs: number): string {
  const cycle = getSpinnerFramesCycle()
  return cycle[Math.floor(nowMs / SPINNER_FRAME_MS) % cycle.length]
}
