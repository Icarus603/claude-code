import React from 'react'
import type { StatsStore } from './context/stats.js'
import type { Root } from '@anthropic/ink'
import type { InteractiveHostSession } from '@claude-code/app-host'
import type { Props as REPLProps } from './screens/REPL.js'
import type { AppState } from './state/AppStateStore.js'
import type { FpsMetrics } from './utils/fpsTracker.js'

export type AppWrapperProps = {
  getFpsMetrics: () => FpsMetrics | undefined
  stats?: StatsStore
  initialState: AppState
}

export type LaunchReplArgs = {
  root: Root
  session: InteractiveHostSession<AppState>
  appProps: AppWrapperProps
  replProps: REPLProps
  renderAndRun: (root: Root, element: React.ReactNode) => Promise<void>
}

export async function launchRepl({
  root,
  session,
  appProps,
  replProps,
  renderAndRun,
}: LaunchReplArgs): Promise<void> {
  const { App } = await import('./components/App.js')
  const { REPL } = await import('./screens/REPL.js')

  await renderAndRun(
    root,
    <App {...appProps} store={session.store}>
      <REPL
        {...replProps}
        runtimeGraph={session.runtimeGraph}
      />
    </App>,
  )
}
