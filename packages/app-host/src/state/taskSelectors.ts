import type { AppState } from './AppStateStore.js';

export const selectTasks = (state: AppState) => state.tasks;
export const selectViewingAgentTaskId = (state: AppState) => state.viewingAgentTaskId;
export const selectFileHistory = (state: AppState) => state.fileHistory;
