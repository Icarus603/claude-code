/**
 * App-host lifecycle helpers — minimal primitives for composition-root
 * packages that need to register shutdown handlers, measure startup phase
 * durations, and coordinate ordered teardown across subsystems.
 *
 * V7 §8.1 — these live in app-host so integration packages don't
 * rediscover lifecycle wiring independently.
 */

/**
 * A shutdown handler runs once during graceful teardown. Return a promise
 * if teardown is async; the composer awaits all handlers in registration
 * order (LIFO) so late-installed handlers tear down before earlier ones.
 */
export type ShutdownHandler = () => void | Promise<void>

interface ShutdownRegistry {
  register(handler: ShutdownHandler, label?: string): () => void
  drain(): Promise<void>
  size(): number
}

interface RegisteredHandler {
  handler: ShutdownHandler
  label: string | undefined
}

export function createShutdownRegistry(): ShutdownRegistry {
  const handlers: RegisteredHandler[] = []
  return {
    register(handler, label) {
      const entry: RegisteredHandler = { handler, label }
      handlers.push(entry)
      return () => {
        const idx = handlers.indexOf(entry)
        if (idx >= 0) handlers.splice(idx, 1)
      }
    },
    async drain() {
      // LIFO order: last-registered, first-torn-down.
      while (handlers.length > 0) {
        const entry = handlers.pop()
        if (!entry) continue
        try {
          await entry.handler()
        } catch {
          // Handlers may fail during abnormal teardown; continue draining
          // so a single flaky handler can't block other cleanup.
        }
      }
    },
    size() {
      return handlers.length
    },
  }
}

/**
 * Startup phase telemetry. Mark phase boundaries as the composition root
 * installs bindings and starts subsystems; query durations later for
 * logging or the /doctor health panel.
 */
export interface StartupPhaseRecord {
  phase: string
  startedAtMs: number
  completedAtMs: number | null
  durationMs: number | null
}

export interface StartupTimeline {
  start(phase: string): void
  end(phase: string): void
  record(): readonly StartupPhaseRecord[]
}

export function createStartupTimeline(now: () => number = () => Date.now()): StartupTimeline {
  const records = new Map<string, StartupPhaseRecord>()
  const order: string[] = []
  return {
    start(phase) {
      if (records.has(phase)) return
      records.set(phase, {
        phase,
        startedAtMs: now(),
        completedAtMs: null,
        durationMs: null,
      })
      order.push(phase)
    },
    end(phase) {
      const r = records.get(phase)
      if (!r || r.completedAtMs !== null) return
      const t = now()
      r.completedAtMs = t
      r.durationMs = t - r.startedAtMs
    },
    record() {
      return order.map(phase => records.get(phase)!).filter(Boolean)
    },
  }
}

/**
 * Coordinate a bounded wait for subsystem-ready signals. Returns when all
 * registered signals resolve, or rejects after the timeout with the labels
 * of signals that hadn't completed — useful for startup health checks.
 */
export async function awaitAllReady(
  signals: Array<{ label: string; ready: Promise<unknown> }>,
  timeoutMs: number,
): Promise<void> {
  const pending = new Set(signals.map(s => s.label))
  await Promise.race([
    Promise.all(
      signals.map(s =>
        s.ready.then(() => {
          pending.delete(s.label)
        }),
      ),
    ),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `startup ready-signals timed out after ${timeoutMs}ms; pending: ${[...pending].join(', ')}`,
          ),
        )
      }, timeoutMs).unref?.()
    }),
  ])
}
