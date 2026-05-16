/**
 * FleetView glyph constants.
 *
 * Source mapping:
 *   sq_ (ant 0664.js:18) → WAITING_GLYPH "∙" — pinned/idle row marker
 *   sH.tick               → figures.tick    — success badge
 *   sH.cross              → figures.cross   — failure badge
 *   sH.pointer            → figures.pointer — list selection caret
 *   sH.arrowRight         → "→"             — "→ to return" indicator
 *   sH.arrowDown / arrowUp → figures arrows  — reorder hint
 *
 * Plus the spinner-related glyphs `getSteadyGlyph()` / `getCompletedGlyph()`
 * live in `spinnerFrames.ts`.
 */

import figures from 'figures'

/** Source: ant sq_ at 0664.js:18 = "∙" BULLET OPERATOR. */
export const WAITING_GLYPH = '∙'

export const TICK_GLYPH = figures.tick
export const CROSS_GLYPH = figures.cross
export const POINTER_GLYPH = figures.pointer
export const ARROW_RIGHT_GLYPH = figures.arrowRight
export const ARROW_DOWN_GLYPH = figures.arrowDown
export const ARROW_UP_GLYPH = figures.arrowUp
