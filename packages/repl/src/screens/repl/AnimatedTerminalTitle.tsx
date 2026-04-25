import { useEffect, useState } from 'react'
import { useTerminalFocus, useTerminalTitle } from '@anthropic/ink'

const TITLE_ANIMATION_FRAMES = ['⠂', '⠐']
const TITLE_STATIC_PREFIX = '✳'
const TITLE_ANIMATION_INTERVAL_MS = 960

/**
 * Sets the terminal tab title, with an animated prefix glyph while a query
 * is running. Isolated from REPL so the 960ms animation tick re-renders only
 * this leaf component (which returns null — pure side-effect) instead of the
 * entire REPL tree. Before extraction, the tick was ~1 REPL render/sec for
 * the duration of every turn, dragging PromptInput and friends along.
 *
 * V7 §3.3 — extracted from REPLView.tsx (iter 18).
 */
export function AnimatedTerminalTitle({
  isAnimating,
  title,
  disabled,
  noPrefix,
}: {
  isAnimating: boolean
  title: string
  disabled: boolean
  noPrefix: boolean
}): null {
  const terminalFocused = useTerminalFocus()
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (disabled || noPrefix || !isAnimating || !terminalFocused) return
    const interval = setInterval(
      setFrame => setFrame(f => (f + 1) % TITLE_ANIMATION_FRAMES.length),
      TITLE_ANIMATION_INTERVAL_MS,
      setFrame,
    )
    return () => clearInterval(interval)
  }, [disabled, noPrefix, isAnimating, terminalFocused])
  const prefix = isAnimating ? (TITLE_ANIMATION_FRAMES[frame] ?? TITLE_STATIC_PREFIX) : TITLE_STATIC_PREFIX
  useTerminalTitle(disabled ? null : noPrefix ? title : `${prefix} ${title}`)
  return null
}
