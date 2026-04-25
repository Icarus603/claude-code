import type { AppState } from '@claude-code/app-host/state/AppStateStore.js';

export const selectToolPermissionContext = (state: AppState) => state.toolPermissionContext;
export const selectPendingWorkerRequest = (state: AppState) => state.pendingWorkerRequest;
export const selectPendingSandboxRequest = (state: AppState) => state.pendingSandboxRequest;
export const selectWorkerSandboxPermissions = (state: AppState) => state.workerSandboxPermissions;
