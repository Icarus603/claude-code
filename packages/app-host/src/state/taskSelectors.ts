import type { AppState } from '@claude-code/app-host/state/AppStateStore.js';

export const selectTasks = (state: AppState) => state.tasks;
export const selectViewingAgentTaskId = (state: AppState) => state.viewingAgentTaskId;
export const selectFileHistory = (state: AppState) => state.fileHistory;
