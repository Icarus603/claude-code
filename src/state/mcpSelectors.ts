import type { AppState } from './AppStateStore.js';

export const selectMcp = (state: AppState) => state.mcp;
export const selectElicitation = (state: AppState) => state.elicitation;
