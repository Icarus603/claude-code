import type { Lesson } from './types.js'
import { lesson as atMentions } from './at-mentions.js'
import { lesson as modes } from './modes.js'
import { lesson as undo } from './undo.js'

/**
 * All lessons in display order. Each lesson lives in its own file under
 * this directory; adding a new lesson means adding the import + array entry
 * here. Order matters for the picker default focus and for the LogoV2
 * banner's `(X/N)` denominator.
 *
 * The 10-lesson set is documented in
 * `docs/superpowers/specs/2026-05-08-powerup-design.md` §3.
 */
export const ALL_LESSONS: Lesson[] = [
  atMentions,
  modes,
  undo,
]
