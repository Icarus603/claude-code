
import { initializeErrorLogSink } from './errorLogSink.js'

/**
 * Attach process-local sinks that do not forward telemetry externally.
 * Called from setup() for the default command; other entrypoints (subcommands,
 * daemon, bridge) call this directly since they bypass setup().
 *
 * Leaf module — kept out of setup.ts to avoid the setup → commands → bridge
 * → setup import cycle.
 */
export function initSinks(): void {
  initializeErrorLogSink()
}
