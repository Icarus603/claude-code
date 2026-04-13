/**
 * @claude-code/output/testing
 *
 * V7 §9.11 — in-memory fake for the output package.
 * Must NOT import from ../internal/ (V7 §9.11 hard rule).
 */
import type { OutputEvent, OutputTarget } from '../contracts.js'

export type { OutputEvent, OutputTarget }

/**
 * CapturingOutputTarget — captures all emitted OutputEvents into a typed
 * array. Tests can inspect `.events` after exercising the system under test.
 */
export class CapturingOutputTarget implements OutputTarget {
  readonly events: OutputEvent[] = []

  emit(event: OutputEvent): void {
    this.events.push(event)
  }

  flush(): void {}

  close(): void {}

  /** Clear all captured events. */
  reset(): void {
    this.events.length = 0
  }
}
