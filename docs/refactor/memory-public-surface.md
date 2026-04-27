# @claude-code/memory — exports audit

**Total**: 33  |  Public: 18  |  Internal-only: 0  |  Dead: 12  |  Protected: 4

## Truly dead (safe to remove)

- `./memoryEntrypoint` -> `./src/memoryEntrypoint.ts`
- `./findRelevantMemories` -> `./src/findRelevantMemories.ts`
- `./teamMemPrompts` -> `./src/teamMemPrompts.ts`
- `./memoryTypes` -> `./src/memoryTypes.ts`
- `./autoDream` -> `./src/autoDream.ts`
- `./autoDreamConfig` -> `./src/autoDreamConfig.ts`
- `./consolidationPrompt` -> `./src/consolidationPrompt.ts`
- `./teamMemorySync` -> `./src/teamMemorySync.ts`
- `./teamMemSecretScanner` -> `./src/teamMemSecretScanner.ts`
- `./teamMemSyncTypes` -> `./src/teamMemSyncTypes.ts`
- `./memdir/memoryShapeTelemetry.js` -> `./src/memdir/memoryShapeTelemetry.ts`
- `./memdir/memoryScan.js` -> `./src/memdir/memoryScan.ts`

## Internal-only (safe to remove after relativization)


## Protected entries (kept regardless of usage — V7 §9.11 / API contract)

- `.` (ext=12, int=0) -> `./src/index.ts`
- `./contracts` (ext=0, int=0) -> `./src/contracts.ts`
- `./errors` (ext=0, int=0) -> `./src/errors.ts`
- `./testing` (ext=0, int=0) -> `./testing/index.ts`

## Public surface

- `.` (ext=12, int=0) -> `./src/index.ts`
- `./agentMemory` (ext=12, int=0) -> `./src/agentMemory.ts`
- `./paths` (ext=10, int=0) -> `./src/paths.ts`
- `./teamMemPaths` (ext=4, int=0) -> `./src/teamMemPaths.ts`
- `./memoryFileDetection` (ext=4, int=0) -> `./src/memoryFileDetection.ts`
- `./extractMemories` (ext=2, int=0) -> `./src/extractMemories.ts`
- `./memorySourceTypes` (ext=2, int=0) -> `./src/memorySourceTypes.ts`
- `./teamMemSecretGuard` (ext=2, int=0) -> `./src/teamMemSecretGuard.ts`
- `./teamMemorySyncWatcher` (ext=2, int=0) -> `./src/teamMemorySyncWatcher.ts`
- `./memdir` (ext=1, int=0) -> `./src/memdir.ts`
- `./memoryAge` (ext=1, int=0) -> `./src/memoryAge.ts`
- `./consolidationLock` (ext=1, int=0) -> `./src/consolidationLock.ts`
- `./teamMemoryOps` (ext=1, int=0) -> `./src/teamMemoryOps.ts`
- `./extractMemoriesPrompts` (ext=1, int=0) -> `./src/extractMemoriesPrompts.ts`
- `./sessionMemoryUtils` (ext=1, int=0) -> `./src/sessionMemoryUtils.ts`
- `./sessionMemoryPrompts` (ext=1, int=0) -> `./src/sessionMemoryPrompts.ts`
- `./projectGitInfo` (ext=1, int=0) -> `./src/projectGitInfo.ts`
- `./memoryShapeTelemetry` (ext=1, int=0) -> `./src/memoryShapeTelemetry.ts`
