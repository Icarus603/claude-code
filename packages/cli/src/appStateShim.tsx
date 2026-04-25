// V7 §7.2 — lazy require() shim so cli package does not import
// src/state/AppState directly at top level. The AppStateProvider is a React
// component, so we re-export it via require() at module-load time (cheap).
import * as React from 'react'

export type AppState = unknown

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require('@claude-code/app-host/state/AppState.js') as {
  AppStateProvider: React.ComponentType<{
    children?: React.ReactNode
    onChangeAppState?: (prev: unknown, next: unknown) => void
  }>
}

export const AppStateProvider = mod.AppStateProvider
