// Lazy shim to access app-level state constants without importing
// src/state/AppStateStore.js directly (V7 §7.2).
import type { AppStateLike } from './contracts.js'

export type { AppStateLike as AppState } from './contracts.js'

export function getIdleSpeculationState(): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('src/state/AppStateStore.js') as { IDLE_SPECULATION_STATE: unknown }
  return mod.IDLE_SPECULATION_STATE
}

export type { AppStateLike }
