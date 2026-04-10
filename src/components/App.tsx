import React from 'react'
import { FpsMetricsProvider } from '../context/fpsMetrics.js'
import { StatsProvider, type StatsStore } from '../context/stats.js'
import {
  type AppState,
  type AppStateStore,
  AppStateProvider,
} from '../state/AppState.js'
import { onChangeAppState } from '../state/onChangeAppState.js'
import type { FpsMetrics } from '../utils/fpsTracker.js'

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
