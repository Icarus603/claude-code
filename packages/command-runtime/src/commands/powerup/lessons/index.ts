import type { Lesson } from './types.js'
import { lesson as atMentions } from './at-mentions.js'
import { lesson as modes } from './modes.js'
import { lesson as undo } from './undo.js'
import { lesson as background } from './background.js'
import { lesson as memory } from './memory.js'
import { lesson as mcp } from './mcp.js'
import { lesson as automate } from './automate.js'

/**
 * All lessons in display order. Each lesson lives in its own file under
 * this directory; adding a new lesson means adding the import + array entry
 * here. Order matters for the picker default focus and for the LogoV2
 * banner's `(X/N)` denominator (denominator is the live array length, so
 * the banner stays correct as lessons land).
 *
 * The final 10-lesson set is documented in
 * `docs/superpowers/specs/2026-05-08-powerup-design.md` §3. Currently
 * 7 of 10 are implemented (steps 1–7 of the §11 plan).
 */
export const ALL_LESSONS: Lesson[] = [
  atMentions,
  modes,
  undo,
  background,
  memory,
  mcp,
  automate,
]
