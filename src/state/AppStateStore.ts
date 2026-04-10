// Deprecated compat facade. `AppState` remains available for existing UI
// consumers, but host/runtime ownership is moving behind session stores and
// runtime handles.
export type {
  AppState,
  AppStateStore,
  CompletionBoundary,
  FooterItem,
  SpeculationResult,
  SpeculationState,
} from './AppStateCompat.js'
export {
  getDefaultAppState,
  IDLE_SPECULATION_STATE,
} from './AppStateCompat.js'
