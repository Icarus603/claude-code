/**
 * Keyboard event routing for the FleetView.
 *
 * Source: ant 5092.js `xd` (around line 2767) — the full chord cascade is
 * ~430 LOC. This hook covers the core navigation + chord set that maps
 * to the screenshots:
 *
 *   - up / down / ctrl+p / ctrl+n  → move selection
 *   - enter                         → activate (open job / fold expand / collapse)
 *   - space                         → open peek panel on a job row
 *   - escape                        → clear filter / close peek / close help
 *   - ?                              → toggle help overlay
 *   - ctrl+c                        → exit fleet view (caller-provided)
 *   - ctrl+r                        → start inline rename on focused job
 *   - ctrl+t                        → toggle pin
 *   - ctrl+s                        → toggle group mode
 *   - ctrl+x                        → arm delete (two-step)
 *   - shift+up / shift+down         → reorder within bucket
 *   - left arrow on attached row    → return to fleet (caller-provided)
 *
 * Caller passes a `handlers` bag — each entry is optional so the hook
 * can be composed piecewise.
 */

import { useEffect } from 'react'

export type FleetInputHandlers = Partial<{
  onMove: (delta: number) => void
  onShiftMove: (delta: number) => void
  onEnter: () => void
  onSpace: () => void
  onEscape: () => void
  onQuit: () => void
  onToggleHelp: () => void
  onRename: () => void
  onTogglePin: () => void
  onToggleGroupMode: () => void
  onArmDelete: () => void
  onTextInput: (char: string) => void
  onBackspace: () => void
  onClearFilter: () => void
}>

interface InkInputKey {
  upArrow: boolean
  downArrow: boolean
  leftArrow: boolean
  rightArrow: boolean
  return: boolean
  escape: boolean
  shift: boolean
  ctrl: boolean
  meta: boolean
  backspace: boolean
  delete: boolean
}

type InkInputHandler = (input: string, key: InkInputKey) => void

/**
 * Bind `useInput` to the FleetView chord set. Caller controls which
 * keys it cares about via `handlers`; absent handlers fall through.
 *
 * Note: this hook does not call ink's `useInput` itself — the
 * surrounding FleetView component owns that subscription and dispatches
 * via this hook's returned `handle(input, key)` callback. This keeps
 * the React hook order stable when handlers change between renders.
 */
export function useFleetInputDispatcher(handlers: FleetInputHandlers): InkInputHandler {
  // Stable reference per render — caller passes via useInput(handle).
  return (input: string, key: InkInputKey) => {
    if (key.ctrl && input === 'c') {
      handlers.onQuit?.()
      return
    }
    if (key.escape) {
      handlers.onEscape?.()
      return
    }
    if (key.return) {
      handlers.onEnter?.()
      return
    }
    if (key.shift && (key.upArrow || key.downArrow)) {
      handlers.onShiftMove?.(key.upArrow ? -1 : 1)
      return
    }
    if (key.upArrow || (key.ctrl && input === 'p')) {
      handlers.onMove?.(-1)
      return
    }
    if (key.downArrow || (key.ctrl && input === 'n')) {
      handlers.onMove?.(1)
      return
    }
    if (key.ctrl && input === 'r') {
      handlers.onRename?.()
      return
    }
    if (key.ctrl && input === 't') {
      handlers.onTogglePin?.()
      return
    }
    if (key.ctrl && input === 's') {
      handlers.onToggleGroupMode?.()
      return
    }
    if (key.ctrl && input === 'x') {
      handlers.onArmDelete?.()
      return
    }
    if (input === ' ') {
      handlers.onSpace?.()
      return
    }
    if (input === '?') {
      handlers.onToggleHelp?.()
      return
    }
    if (key.backspace || key.delete) {
      handlers.onBackspace?.()
      return
    }
    if (input !== '' && !key.ctrl && !key.meta) {
      handlers.onTextInput?.(input)
    }
  }
}

/**
 * Convenience: register a cleanup tick (e.g. for armed-delete timeout).
 * Caller passes a function that should fire after `ms` if no further
 * chord is hit; returning a cleanup disarms it.
 */
export function useArmedTimer(armed: boolean, ms: number, onTimeout: () => void): void {
  useEffect(() => {
    if (!armed) return undefined
    const handle = setTimeout(onTimeout, ms)
    return () => clearTimeout(handle)
  }, [armed, ms, onTimeout])
}
