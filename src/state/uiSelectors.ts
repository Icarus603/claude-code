import type { AppState } from './AppStateStore.js';

export const selectShowExpandedTodos = (state: AppState) => state.expandedView === 'tasks';
export const selectUltraplanPendingChoice = (state: AppState) => state.ultraplanPendingChoice;
export const selectUltraplanLaunchPending = (state: AppState) => state.ultraplanLaunchPending;
