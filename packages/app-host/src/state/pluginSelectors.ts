import type { AppState } from './AppStateStore.js';

export const selectPlugins = (state: AppState) => state.plugins;
export const selectAgentDefinitions = (state: AppState) => state.agentDefinitions;
