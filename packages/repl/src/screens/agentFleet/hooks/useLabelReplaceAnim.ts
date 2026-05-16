/**
 * Hook that animates a row label changing in place.
 *
 * Source: ant 5092.js `Ms3` (line 82). When `state.name` is set (after
 * rename or after first-turn auto-name), the row label changes from the
 * old intent snippet to the new name. Ms3 watches the label string and
 * runs `LdK` (labelReplaceFrame) from n=1 up to J = max(graphemes(old),
 * graphemes(new)) over `Math.max(16, Math.floor(360 / J))` ms per step
 * — producing a left-to-right typing replacement.
 *
 * Returns `undefined` when no animation is running, or the current frame
 * `{display, newLen}` otherwise. Caller passes through to FleetJobRow's
 * `typingFrame` prop, which overrides the static label rendering.
 *
 * The first paint of a mounted row never animates: `prevRef` is seeded
 * from the initial label so we only animate subsequent CHANGES.
 */

import { useEffect, useRef, useState } from 'react'

import {
  labelReplaceFrame,
  type LabelReplaceFrame,
} from '../helpers/labelReplaceAnim.js'
import { splitGraphemes } from '../helpers/grapheme.js'

export function useLabelReplaceAnim(label: string): LabelReplaceFrame | undefined {
  const prevRef = useRef(label)
  const [frame, setFrame] = useState<LabelReplaceFrame | undefined>(undefined)

  useEffect(() => {
    const oldLabel = prevRef.current
    if (oldLabel === label) return
    prevRef.current = label
    // First non-empty label → no animation (treat as initial assignment,
    // not a replacement). Mirrors ant: animation only triggers when both
    // labels are non-empty so blank-to-name doesn't typewriter through
    // an empty string of placeholder chars.
    if (oldLabel === '' || label === '') {
      setFrame(undefined)
      return
    }
    const J = Math.max(
      splitGraphemes(oldLabel).length,
      splitGraphemes(label).length,
    )
    if (J === 0) {
      setFrame(undefined)
      return
    }
    const stepMs = Math.max(16, Math.floor(360 / J))
    let n = 1
    setFrame(labelReplaceFrame(oldLabel, label, n))
    let handle: ReturnType<typeof setTimeout> | undefined
    const tick = (): void => {
      n += 1
      if (n > J) {
        setFrame(undefined)
        handle = undefined
        return
      }
      setFrame(labelReplaceFrame(oldLabel, label, n))
      handle = setTimeout(tick, stepMs)
    }
    handle = setTimeout(tick, stepMs)
    return () => {
      if (handle !== undefined) clearTimeout(handle)
    }
  }, [label])

  return frame
}
