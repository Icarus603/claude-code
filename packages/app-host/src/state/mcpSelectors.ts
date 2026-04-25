import type { AppState } from '@claude-code/app-host/state/AppStateStore.js';

export const selectMcp = (state: AppState) => state.mcp;
export const selectElicitation = (state: AppState) => state.elicitation;
