/**
 * Grapheme + width primitives used by FleetView label sizing and the
 * label-replace animation.
 *
 * Source mapping:
 *   ZN_(text)   → splitGraphemes — Intl.Segmenter with granularity:'grapheme'
 *   _XH(text)   → countGraphemes — length of grapheme array
 *   z6(text)    → stringWidth    — terminal column width
 */

import { stringWidth } from '@anthropic/ink'

let graphemeSegmenter: Intl.Segmenter | null = null

function getGraphemeSegmenter(): Intl.Segmenter {
  if (!graphemeSegmenter) {
    graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  }
  return graphemeSegmenter
}

/** Source: ant ZN_. */
export function splitGraphemes(text: string): string[] {
  const segments = getGraphemeSegmenter().segment(text)
  const out: string[] = []
  for (const s of segments) out.push(s.segment)
  return out
}

/** Source: ant _XH. */
export function countGraphemes(text: string): number {
  return splitGraphemes(text).length
}

export { stringWidth }
