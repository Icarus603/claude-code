// V7 §7.2 — lazy require() shim so permission package UI components don't
// import src/state/AppState directly at top level.

export function useAppState<T = unknown>(): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('src/state/AppState.js') as { useAppState: <T>() => T }
  return mod.useAppState<T>()
}

export function useSetAppState(): (updater: (prev: unknown) => unknown) => void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('src/state/AppState.js') as {
    useSetAppState: () => (updater: (prev: unknown) => unknown) => void
  }
  return mod.useSetAppState()
}

export function useAppStateStore<T = unknown>(): {
  getState: () => T
  setState: (updater: (prev: T) => T) => void
  subscribe: (listener: () => void) => () => void
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('src/state/AppState.js') as {
    useAppStateStore: <T>() => {
      getState: () => T
      setState: (updater: (prev: T) => T) => void
      subscribe: (listener: () => void) => () => void
    }
  }
  return mod.useAppStateStore<T>()
}
