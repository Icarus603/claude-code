import type { AppState } from '@claude-code/app-host/state/AppStateStore.js';

export const selectTeamContext = (state: AppState) => state.teamContext;
