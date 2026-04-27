// V7 §7.2 — lazy require() shim so app-host does not statically import
// src/state/AppStateCompat at module level. getDefaultAppState is called
// once during runtime-handle construction, so a require() hop is fine.

export type AppState = unknown

export function getDefaultAppState(): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../state/AppStateCompat.js') as {
    getDefaultAppState: () => unknown
  }
  return mod.getDefaultAppState()
}
