/**
 * Compute a row's display label (the left column with the agent name or
 * a truncated intent snippet).
 *
 * Source: ant vZ6 (5092.js:62-81).
 *
 * Priority:
 *   1. `state.name` (manually set or auto-set after first turn) — strip
 *      control chars, collapse whitespace, trim.
 *   2. First three space-separated words of `state.intent`, sanitised.
 *   3. Fallback: "current session" (if `isCurrentSession`) or
 *      "new session" (for fresh bg) or template name.
 *
 * Truncated to 25 column-width, breaking on grapheme boundaries.
 */

import type { FleetJobState } from '@claude-code/agent/background/fleet/fleetTypes.js'
import { CONTROL_CHAR_RE } from './controlChars.js'
import { stripSystemBlocks } from './flattenDetail.js'
import { splitGraphemes, stringWidth } from './grapheme.js'

const MAX_LABEL_WIDTH = 25

function normaliseWhitespace(text: string): string {
  return text.replace(CONTROL_CHAR_RE, '').replace(/\s+/g, ' ').trim()
}

/** Source: ant vZ6. */
export function jobLabel(state: FleetJobState, isCurrentSession = false): string {
  if (state.name) return normaliseWhitespace(state.name)

  const intentWords = normaliseWhitespace(stripSystemBlocks(state.intent))
    .split(' ')
    .filter(Boolean)

  if (intentWords.length === 0) {
    if (isCurrentSession) return 'current session'
    if (state.template === 'bg' && state.state === 'working') return 'new session'
    return normaliseWhitespace(state.template)
  }

  const head =
    intentWords.length > 3
      ? `${intentWords.slice(0, 3).join(' ')}…`
      : intentWords.join(' ')

  if (stringWidth(head) <= MAX_LABEL_WIDTH) return head

  let out = ''
  let width = 0
  for (const g of splitGraphemes(head)) {
    const w = stringWidth(g)
    if (width + w > MAX_LABEL_WIDTH - 1) break
    out += g
    width += w
  }
  return `${out}…`
}
