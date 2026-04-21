import React from 'react'
import type { Root } from '@anthropic/ink'
import type { InteractiveHostSession } from '@claude-code/app-host'
import type { Props as REPLProps } from '@claude-code/repl/screens/REPL.js'

export type AppWrapperProps<TState, TStats, TFpsMetrics> = {
  getFpsMetrics: () => TFpsMetrics | undefined
  stats?: TStats
  initialState: TState
}

export type LaunchReplArgs<TState, TStats, TFpsMetrics> = {
  root: Root
  session: InteractiveHostSession<TState>
  appProps: AppWrapperProps<TState, TStats, TFpsMetrics>
  replProps: REPLProps
  renderAndRun: (root: Root, element: React.ReactNode) => Promise<void>
}

export async function launchRepl<TState, TStats, TFpsMetrics>({
  root,
  session,
  appProps,
  replProps,
  renderAndRun,
}: LaunchReplArgs<TState, TStats, TFpsMetrics>): Promise<void> {
  const { App } = await import('@claude-code/repl/components/App.js')
  const { REPL } = await import('@claude-code/repl/screens/REPL.js')

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
