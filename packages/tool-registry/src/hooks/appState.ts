// Runtime re-export of app state hooks via host binding, so tool UI code
// stays free of direct src/state/AppState imports (V7 §7.2).
// The actual implementations live in the app, and are resolved lazily
// via require() at call site to avoid eager coupling.

type Store<S> = {
  getState: () => S
  setState: (updater: (prev: S) => S) => void
  subscribe: (listener: () => void) => () => void
}
type SetAppState = (updater: (prev: unknown) => unknown) => void

export function useAppStateStore(): Store<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@claude-code/app-host/state/AppState.js') as { useAppStateStore: () => Store<unknown> }
  return mod.useAppStateStore()
}

export function useSetAppState(): SetAppState {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@claude-code/app-host/state/AppState.js') as { useSetAppState: () => SetAppState }
  return mod.useSetAppState()
}
