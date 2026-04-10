import React from 'react'
import type { StatsStore } from './context/stats.js'
import type { Root } from '@anthropic/ink'
import type { Props as REPLProps } from './screens/REPL.js'
import type { AppState } from './state/AppStateStore.js'
import { syncRuntimeHandlesFromAppState } from './runtime/runtimeHandles.js'
import type { FpsMetrics } from './utils/fpsTracker.js'

type AppWrapperProps = {
  getFpsMetrics: () => FpsMetrics | undefined
  stats?: StatsStore
  initialState: AppState
}

export async function launchRepl(
  root: Root,
  appProps: AppWrapperProps,
  replProps: REPLProps,
  renderAndRun: (root: Root, element: React.ReactNode) => Promise<void>,
): Promise<void> {
  const { App } = await import('./components/App.js')
  const { REPL } = await import('./screens/REPL.js')
  const store =
    replProps.runtimeGraph?.handles.sessionStoreFactory.createInteractiveStore?.(
      appProps.initialState,
    )

  if (replProps.runtimeGraph) {
    syncRuntimeHandlesFromAppState(
      replProps.runtimeGraph.handles,
      store?.getState() ?? appProps.initialState,
    )
  }

  await renderAndRun(
    root,
    <App {...appProps} store={store}>
      <REPL {...replProps} />
    </App>,
  )
}
