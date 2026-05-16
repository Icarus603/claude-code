/**
 * Compute a single frame of the label-replace animation.
 *
 * Source: ant LdK (5092.js:132-145). The owner hook (`Ms3` at 5092.js:82)
 * advances `n` from 1 to `J = max(countGraphemes(old), countGraphemes(new))`
 * over `Math.max(16, Math.floor(360 / J))` ms per frame.
 *
 * Each frame shows the first `n` graphemes of the new label, followed by
 * the trailing portion of the old label that still fits in the combined
 * width — producing a left-to-right "typing" replacement.
 */

import { splitGraphemes, stringWidth } from './grapheme.js'

/** Source: ant LdK. */
export interface LabelReplaceFrame {
  /** Composed display string for this frame. */
  display: string
  /** Grapheme count of the new-label prefix at this frame. */
  newLen: number
}

/** Source: ant LdK. */
export function labelReplaceFrame(
  oldLabel: string,
  newLabel: string,
  n: number,
): LabelReplaceFrame {
  const oldGraphemes = splitGraphemes(oldLabel)
  const newGraphemes = splitGraphemes(newLabel)
  const newPrefix = newGraphemes.slice(0, Math.min(n, newGraphemes.length)).join('')
  const targetWidth = Math.max(stringWidth(oldLabel), stringWidth(newLabel))
  let width = stringWidth(newPrefix)
  let tail = ''
  for (const g of oldGraphemes.slice(n)) {
    const w = stringWidth(g)
    if (width + w > targetWidth) break
    tail += g
    width += w
  }
  return {
    display: newPrefix + tail + ' '.repeat(targetWidth - width),
    newLen: newPrefix.length,
  }
}
