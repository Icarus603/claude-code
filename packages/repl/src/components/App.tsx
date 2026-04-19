import React from 'react'
import { FpsMetricsProvider } from 'src/context/fpsMetrics.js'
import { StatsProvider, type StatsStore } from 'src/context/stats.js'
import {
  type AppState,
  type AppStateStore,
  AppStateProvider,
} from '@claude-code/repl/appStateHooks.js'
import { onChangeAppState } from 'src/state/onChangeAppState.js'
import type { FpsMetrics } from 'src/utils/fpsTracker.js'

type Props = {
  getFpsMetrics: () => FpsMetrics | undefined
  stats?: StatsStore
  initialState: AppState
  store?: AppStateStore
  children: React.ReactNode
}

/**
 * Top-level wrapper for interactive sessions.
 * Provides FPS metrics, stats context, and app state to the component tree.
 */
export function App({
  getFpsMetrics,
  stats,
  initialState,
  store,
  children,
}: Props): React.ReactNode {
  return (
    <FpsMetricsProvider getFpsMetrics={getFpsMetrics}>
      <StatsProvider store={stats}>
        <AppStateProvider
          initialState={initialState}
          store={store}
          onChangeAppState={onChangeAppState}
        >
          {children}
        </AppStateProvider>
      </StatsProvider>
    </FpsMetricsProvider>
  )
}
