/**
 * REPL input mode primitives.
 *
 * V7 §8.24 carve-out — the interactive REPL owns input-mode semantics
 * (insert/vim/plain), coordinates buffer history navigation, and
 * publishes mode transitions so subscribers like the voice indicator
 * and the prompt-footer hint can stay in sync without hard-wiring to
 * the REPL screen component.
 *
 * This file is deliberately host-independent — no Ink, no React, no
 * screen imports. Host components attach the state store via the
 * contract, then read the observable state.
 */

export type InputMode = 'insert' | 'normal' | 'visual' | 'plain'

export interface InputModeTransition {
  readonly from: InputMode
  readonly to: InputMode
  readonly triggeredBy: 'user' | 'programmatic' | 'reset'
  readonly atMs: number
}

type Listener = (mode: InputMode, transition: InputModeTransition) => void

export interface InputModeStore {
  /** Current input mode. */
  getMode(): InputMode
  /** Transition to a new mode. No-op if already in that mode. */
  setMode(mode: InputMode, triggeredBy?: InputModeTransition['triggeredBy']): void
  /** Subscribe to mode transitions. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void
  /** Reset to the default insert mode. */
  reset(): void
  /** Most recent transition (or null before any transition). */
  lastTransition(): InputModeTransition | null
}

const DEFAULT_MODE: InputMode = 'insert'

export interface InputModeStoreOptions {
  initialMode?: InputMode
  now?: () => number
}

export function createInputModeStore(
  options: InputModeStoreOptions = {},
): InputModeStore {
  const now = options.now ?? (() => Date.now())
  let mode: InputMode = options.initialMode ?? DEFAULT_MODE
  let last: InputModeTransition | null = null
  const listeners = new Set<Listener>()

  function notify(transition: InputModeTransition): void {
    last = transition
    // Iterate over a copy so a listener that unsubscribes during dispatch
    // doesn't skip later listeners.
    for (const listener of [...listeners]) {
      try {
        listener(transition.to, transition)
      } catch {
        // Listener exceptions must not break peer listeners.
      }
    }
  }

  return {
    getMode() {
      return mode
    },
    setMode(next, triggeredBy = 'user') {
      if (next === mode) return
      const transition: InputModeTransition = {
        from: mode,
        to: next,
        triggeredBy,
        atMs: now(),
      }
      mode = next
      notify(transition)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    reset() {
      if (mode === DEFAULT_MODE) return
      const transition: InputModeTransition = {
        from: mode,
        to: DEFAULT_MODE,
        triggeredBy: 'reset',
        atMs: now(),
      }
      mode = DEFAULT_MODE
      notify(transition)
    },
    lastTransition() {
      return last
    },
  }
}

/**
 * Static classifier: maps a mode to whether it accepts printable character
 * input as literal text. Vim `normal` and `visual` consume keystrokes as
 * commands, while `insert` and `plain` treat them as text.
 */
export function modeAcceptsLiteralInput(mode: InputMode): boolean {
  return mode === 'insert' || mode === 'plain'
}
