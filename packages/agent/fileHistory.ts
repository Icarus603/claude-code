export type {
  DiffStats,
  FileHistoryBackup,
  FileHistorySnapshot,
  FileHistoryState,
} from './internal/fileHistoryCore.js'

export {
  copyFileHistoryForResume,
  fileHistoryCanRestore,
  fileHistoryEnabled,
  fileHistoryGetDiffStats,
  fileHistoryHasAnyChanges,
  fileHistoryMakeSnapshot,
  fileHistoryRestoreStateFromLog,
  fileHistoryRewind,
  fileHistoryTrackEdit,
} from './internal/fileHistoryCore.js'
