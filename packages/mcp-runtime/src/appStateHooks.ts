// V7 §7.2 — lazy require() shim so mcp-runtime package does not import
// src/state/AppState directly at top level. Forwards args verbatim.

export type AppState = unknown

export function useAppState<T>(selector: (state: unknown) => T): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@claude-code/app-host/state/AppState.js') as {
    useAppState: <U>(s: (state: unknown) => U) => U
  }
  return mod.useAppState<T>(selector)
}

export function useSetAppState(): (updater: (prev: unknown) => unknown) => void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@claude-code/app-host/state/AppState.js') as {
    useSetAppState: () => (updater: (prev: unknown) => unknown) => void
  }
  return mod.useSetAppState()
}

export function useAppStateStore(): {
  getState: () => unknown
  setState: (updater: (prev: unknown) => unknown) => void
  subscribe: (listener: () => void) => () => void
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@claude-code/app-host/state/AppState.js') as {
    useAppStateStore: () => {
      getState: () => unknown
      setState: (updater: (prev: unknown) => unknown) => void
      subscribe: (listener: () => void) => () => void
    }
  }
  return mod.useAppStateStore()
}
