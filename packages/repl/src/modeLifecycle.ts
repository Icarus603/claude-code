/**
 * REPL mode lifecycle — permission-mode hysteresis + activity heartbeats.
 *
 * The REPL screen needs to remember when a permission escalation was last
 * granted so it can warn when the dangerous window has elapsed without
 * activity. Keeping the bookkeeping here (host-independent) lets the voice
 * indicator, prompt footer, and bridge layer share the same signal.
 */

export interface ModeLifecycleEvent {
  readonly kind: 'enter' | 'exit' | 'refresh'
  readonly atMs: number
  readonly prevActiveForMs: number | null
}

type Listener = (event: ModeLifecycleEvent) => void

export interface ModeLifecycleTracker {
  enter(): void
  exit(): void
  refresh(): void
  isActive(): boolean
  activeForMs(): number
  subscribe(listener: Listener): () => void
}

export interface ModeLifecycleOptions {
  now?: () => number
}

export function createModeLifecycleTracker(
  options: ModeLifecycleOptions = {},
): ModeLifecycleTracker {
  const now = options.now ?? (() => Date.now())
  let enteredAt: number | null = null
  let lastRefreshAt: number | null = null
  const listeners = new Set<Listener>()

  function notify(event: ModeLifecycleEvent): void {
    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch {
        // Listener failures must not interrupt peer listeners.
      }
    }
  }

  return {
    enter() {
      if (enteredAt !== null) return
      enteredAt = now()
      lastRefreshAt = enteredAt
      notify({ kind: 'enter', atMs: enteredAt, prevActiveForMs: null })
    },
    exit() {
      if (enteredAt === null) return
      const closedAt = now()
      const lived = closedAt - enteredAt
      enteredAt = null
      lastRefreshAt = null
      notify({ kind: 'exit', atMs: closedAt, prevActiveForMs: lived })
    },
    refresh() {
      if (enteredAt === null) return
      lastRefreshAt = now()
      notify({ kind: 'refresh', atMs: lastRefreshAt, prevActiveForMs: lastRefreshAt - enteredAt })
    },
    isActive() {
      return enteredAt !== null
    },
    activeForMs() {
      if (enteredAt === null) return 0
      return now() - enteredAt
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * Pure predicate — returns true when the current mode has been active
 * longer than the staleness threshold, indicating the prompt footer should
 * surface a "still in dangerous mode" hint.
 */
export function modeIsStale(
  tracker: ModeLifecycleTracker,
  stalenessMs: number,
): boolean {
  if (!tracker.isActive()) return false
  return tracker.activeForMs() >= stalenessMs
}
