import type { AppState } from './AppStateStore.js';

export const selectTeamContext = (state: AppState) => state.teamContext;
