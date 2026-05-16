/**
 * Hook that animates a row label changing in place.
 *
 * Source: ant 5092.js `Ms3` (line 82). Verbatim semantics:
 *
 *   function Ms3(H, _) {  // H = current label, _ = hasName
 *     ref = { label, hasName, fired }
 *     A = () => {
 *       if (ref.fired || ref.hasName || !_) {
 *         ref = { label: H, hasName: _, fired: ref.fired }
 *         return  // skip animation
 *       }
 *       let oldLabel = ref.label
 *       ref = { label: H, hasName: true, fired: true }
 *       // ...animate from oldLabel to H over J steps at 360/J ms/step...
 *     }
 *
 * Animation fires EXACTLY ONCE per row mount — specifically on the
 * transition from `hasName === false` to `hasName === true` (typically
 * the auto-name event after first turn, or a manual rename of a not-
 * yet-named session). Subsequent label changes (renaming after the
 * row already had a name, intent updates, etc) do NOT animate. This
 * preserves the original "watching a worker pick its identity" cue
 * without animating every minor label edit forever.
 *
 * Returns the current frame `{display, newLen}` while animating, or
 * `undefined` when not animating (either pre-animation or post-fire).
 */

import { useLayoutEffect, useRef, useState } from 'react'

import {
  labelReplaceFrame,
  type LabelReplaceFrame,
} from '../helpers/labelReplaceAnim.js'
import { splitGraphemes } from '../helpers/grapheme.js'

interface AnimRef {
  label: string
  hasName: boolean
  fired: boolean
}

export function useLabelReplaceAnim(
  label: string,
  hasName: boolean,
): LabelReplaceFrame | undefined {
  const ref = useRef<AnimRef>({ label, hasName, fired: false })
  const [frame, setFrame] = useState<LabelReplaceFrame | undefined>(undefined)

  // useLayoutEffect — ant uses useLayoutEffect for Ms3 (precommit), so
  // the animation starts in the same frame as the label change rather
  // than one tick later.
  useLayoutEffect(() => {
    // Skip when: animation already fired this row mount, the row
    // already had a name on entry, or it still doesn't have a name.
    // (Identical to ant's `if(fired || hasName || !_)`.)
    if (ref.current.fired || ref.current.hasName || !hasName) {
      ref.current = {
        label,
        hasName,
        fired: ref.current.fired,
      }
      return
    }
    const oldLabel = ref.current.label
    ref.current = { label, hasName: true, fired: true }
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
      if (n >= J) {
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
      setFrame(undefined)
    }
  }, [label, hasName])

  return frame
}
