// Compatibility shim for Phase 3. File history implementation ownership now
// lives in @claude-code/agent/file-history; remove this shim once all src/*
// callers have migrated to the package surface.

export type {
  DiffStats,
  FileHistoryBackup,
  FileHistorySnapshot,
  FileHistoryState,
} from '@claude-code/agent/file-history'

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
} from '@claude-code/agent/file-history'
