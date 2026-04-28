# @claude-code/storage — exports audit

**Total**: 56  |  Public: 39  |  Internal-only: 0  |  Dead: 13  |  Protected: 4

## Truly dead (safe to remove)

- `./jsonRead.js` -> `./src/jsonRead.ts`
- `./fileEncoding.js` -> `./src/fileEncoding.ts`
- `./parseGitRemote.js` -> `./src/parseGitRemote.ts`
- `./sessionStoragePredicates.js` -> `./src/sessionStoragePredicates.ts`
- `./sessionPaths.js` -> `./src/sessionPaths.ts`
- `./agentMetadata.js` -> `./src/agentMetadata.ts`
- `./conversationChain.js` -> `./src/conversationChain.ts`
- `./fileReadCache.js` -> `./src/fileReadCache.ts`
- `./filePersistence/outputsScanner.js` -> `./src/filePersistence/outputsScanner.ts`
- `./secureStorage/types.js` -> `./src/secureStorage/types.ts`
- `./secureStorage/plainTextStorage.js` -> `./src/secureStorage/plainTextStorage.ts`
- `./secureStorage/index.js` -> `./src/secureStorage/index.ts`
- `./secureStorage/fallbackStorage.js` -> `./src/secureStorage/fallbackStorage.ts`

## Internal-only (safe to remove after relativization)


## Protected entries (kept regardless of usage — V7 §9.11 / API contract)

- `.` (ext=0, int=0) -> `./src/index.ts`
- `./contracts` (ext=0, int=0) -> `./src/contracts.ts`
- `./errors` (ext=0, int=0) -> `./src/errors.ts`
- `./testing` (ext=0, int=0) -> `./src/testing/index.ts`

## Public surface

- `./fsOperations.js` (ext=64, int=0) -> `./src/fsOperations.ts`
- `./sessionStorage.js` (ext=59, int=0) -> `./src/sessionStorage.ts`
- `./file.js` (ext=52, int=0) -> `./src/file.ts`
- `./git.js` (ext=39, int=0) -> `./src/git.ts`
- `./path.js` (ext=32, int=0) -> `./src/path.ts`
- `./browser.js` (ext=23, int=0) -> `./src/browser.ts`
- `./json.js` (ext=22, int=0) -> `./src/json.ts`
- `./plans.js` (ext=22, int=0) -> `./src/plans.ts`
- `./task/diskOutput.js` (ext=22, int=0) -> `./src/task/diskOutput.ts`
- `./claudemd.js` (ext=21, int=0) -> `./src/claudemd.ts`
- `./imageResizer.js` (ext=21, int=0) -> `./src/imageResizer.ts`
- `./toolResultStorage.js` (ext=20, int=0) -> `./src/toolResultStorage.ts`
- `./detectRepository.js` (ext=14, int=0) -> `./src/detectRepository.ts`
- `./sessionStart.js` (ext=9, int=0) -> `./src/sessionStart.ts`
- `./sessionState.js` (ext=9, int=0) -> `./src/sessionState.ts`
- `./editor.js` (ext=9, int=0) -> `./src/editor.ts`
- `./lockfile.js` (ext=8, int=0) -> `./src/lockfile.ts`
- `./fileRead.js` (ext=8, int=0) -> `./src/fileRead.ts`
- `./windowsPaths.js` (ext=8, int=0) -> `./src/windowsPaths.ts`
- `./secureStorage.js` (ext=7, int=0) -> `./src/secureStorage.ts`
- `./sessionRestore.js` (ext=6, int=0) -> `./src/sessionRestore.ts`
- `./sessionActivity.js` (ext=5, int=0) -> `./src/sessionActivity.ts`
- `./sessionEnvironment.js` (ext=5, int=0) -> `./src/sessionEnvironment.ts`
- `./cache-paths` (ext=4, int=0) -> `./src/cache-paths.ts`
- `./sessionEnvVars.js` (ext=4, int=0) -> `./src/sessionEnvVars.ts`
- `./tempfile.js` (ext=4, int=0) -> `./src/tempfile.ts`
- `./imageValidation.js` (ext=4, int=0) -> `./src/imageValidation.ts`
- `./xdg.js` (ext=4, int=0) -> `./src/xdg.ts`
- `./getWorktreePaths.js` (ext=3, int=0) -> `./src/getWorktreePaths.ts`
- `./sessionStoragePortable.js` (ext=3, int=0) -> `./src/sessionStoragePortable.ts`
- `./pdfUtils.js` (ext=3, int=0) -> `./src/pdfUtils.ts`
- `./getWorktreePathsPortable.js` (ext=2, int=0) -> `./src/getWorktreePathsPortable.ts`
- `./glob.js` (ext=2, int=0) -> `./src/glob.ts`
- `./secureStorage/macOsKeychainStorage.js` (ext=1, int=0) -> `./src/secureStorage/macOsKeychainStorage.ts`
- `./findGitRoot.js` (ext=1, int=0) -> `./src/findGitRoot.ts`
- `./filePersistence/types.js` (ext=1, int=0) -> `./src/filePersistence/types.ts`
- `./filePersistence/filePersistence.js` (ext=1, int=0) -> `./src/filePersistence/filePersistence.ts`
- `./secureStorage/macOsKeychainHelpers.js` (ext=1, int=0) -> `./src/secureStorage/macOsKeychainHelpers.ts`
- `./secureStorage/keychainPrefetch.js` (ext=1, int=0) -> `./src/secureStorage/keychainPrefetch.ts`
