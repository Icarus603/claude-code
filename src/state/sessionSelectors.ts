import type { AppState } from './AppStateStore.js';

export const selectVerbose = (state: AppState) => state.verbose;
export const selectIsBriefOnly = (state: AppState) => state.isBriefOnly;
export const selectInitialMessage = (state: AppState) => state.initialMessage;
export const selectSpinnerTip = (state: AppState) => state.spinnerTip;
export const selectShowRemoteCallout = (state: AppState) => state.showRemoteCallout;
export const selectRemoteSessionUrl = (state: AppState) => state.remoteSessionUrl;
