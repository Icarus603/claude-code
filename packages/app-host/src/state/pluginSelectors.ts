import type { AppState } from '@claude-code/app-host/state/AppStateStore.js';

export const selectPlugins = (state: AppState) => state.plugins;
export const selectAgentDefinitions = (state: AppState) => state.agentDefinitions;
