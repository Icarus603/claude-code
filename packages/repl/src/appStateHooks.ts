// V7 §7.2 — lazy require() shim so repl package UI doesn't directly
// import src/state/AppState at top level. Forwards args verbatim.
import type { Context, ReactNode } from 'react'

export type AppState = unknown
export type FooterItem = unknown

/**
 * Lazy accessor for the AppStoreContext singleton. Returns the same React
 * Context instance each call — safe to pass to useContext(). Consumers that
 * need the Context at render time should call this inline:
 *
 *   const store = useContext(getAppStoreContext())
 */
export function getAppStoreContext(): Context<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@claude-code/app-host/state/AppState.js') as {
    AppStoreContext: Context<unknown>
  }
  return mod.AppStoreContext
}

export function useAppState<T>(selector: (state: unknown) => T): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@claude-code/app-host/state/AppState.js') as {
    useAppState: <U>(s: (state: unknown) => U) => U
  }
  return mod.useAppState<T>(selector)
}

export function useAppStateMaybeOutsideOfProvider<T>(
  selector: (state: unknown) => T,
): T | undefined {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@claude-code/app-host/state/AppState.js') as {
    useAppStateMaybeOutsideOfProvider: <U>(s: (state: unknown) => U) => U | undefined
  }
  return mod.useAppStateMaybeOutsideOfProvider<T>(selector)
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

export function AppStateProvider(props: {
  initialState: unknown
  children: ReactNode
}): ReactNode {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@claude-code/app-host/state/AppState.js') as {
    AppStateProvider: (p: { initialState: unknown; children: ReactNode }) => ReactNode
  }
  return mod.AppStateProvider(props)
}
