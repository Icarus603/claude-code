# @claude-code/app-host — exports audit

**Total**: 40  |  Public: 30  |  Internal-only: 0  |  Dead: 9  |  Protected: 2

## Truly dead (safe to remove)

- `./packageHostSetup` -> `./src/packageHostSetup.ts`
- `./packageHostSetupOrchestrator.js` -> `./src/packageHostSetupOrchestrator.ts`
- `./commands/initCommand.js` -> `./src/commands/initCommand.ts`
- `./commands/init-verifiers.js` -> `./src/commands/init-verifiers.ts`
- `./state/teammateViewHelpers.js` -> `./src/state/teammateViewHelpers.ts`
- `./context/promptOverlayContext.js` -> `./src/context/promptOverlayContext.tsx`
- `./context/overlayContext.js` -> `./src/context/overlayContext.tsx`
- `./context/modalContext.js` -> `./src/context/modalContext.tsx`
- `./context/voice.js` -> `./src/context/voice.tsx`

## Internal-only (safe to remove after relativization)


## Protected entries (kept regardless of usage — V7 §9.11 / API contract)

- `.` (ext=8, int=0) -> `./src/index.ts`
- `./contracts` (ext=0, int=0) -> `./src/contracts.ts`

## Public surface

- `./bootstrap/*.js` (ext=300, int=0) -> `./src/bootstrap/*.ts`
- `./state/AppState.js` (ext=35, int=0) -> `./src/state/AppState.tsx`
- `./startup/*.js` (ext=12, int=0) -> `./src/startup/*.ts`
- `.` (ext=8, int=0) -> `./src/index.ts`
- `./state/AppStateStore.js` (ext=8, int=0) -> `./src/state/AppStateStore.ts`
- `./runtime/*.js` (ext=7, int=0) -> `./src/runtime/*.ts`
- `./main/*.js` (ext=6, int=0) -> `./src/main/*.ts`
- `./context/stats.js` (ext=4, int=0) -> `./src/context/stats.tsx`
- `./init.js` (ext=3, int=0) -> `./src/init.ts`
- `./activityManager.js` (ext=2, int=0) -> `./src/activityManager.ts`
- `./state/sessionSelectors.js` (ext=2, int=0) -> `./src/state/sessionSelectors.ts`
- `./state/uiSelectors.js` (ext=2, int=0) -> `./src/state/uiSelectors.ts`
- `./state/pluginSelectors.js` (ext=2, int=0) -> `./src/state/pluginSelectors.ts`
- `./state/teamSelectors.js` (ext=2, int=0) -> `./src/state/teamSelectors.ts`
- `./state/taskSelectors.js` (ext=2, int=0) -> `./src/state/taskSelectors.ts`
- `./state/permissionSelectors.js` (ext=2, int=0) -> `./src/state/permissionSelectors.ts`
- `./state/mcpSelectors.js` (ext=2, int=0) -> `./src/state/mcpSelectors.ts`
- `./state/store.js` (ext=2, int=0) -> `./src/state/store.ts`
- `./context/fpsMetrics.js` (ext=2, int=0) -> `./src/context/fpsMetrics.tsx`
- `./context/QueuedMessageContext.js` (ext=2, int=0) -> `./src/context/QueuedMessageContext.tsx`
- `./context/notifications.js` (ext=2, int=0) -> `./src/context/notifications.tsx`
- `./providerHostSetup.js` (ext=1, int=0) -> `./src/providerHostSetup.ts`
- `./cliArgs.js` (ext=1, int=0) -> `./src/cliArgs.ts`
- `./launchRepl` (ext=1, int=0) -> `./src/launchRepl.tsx`
- `./launchRepl.js` (ext=1, int=0) -> `./src/launchRepl.tsx`
- `./heapDumpService.js` (ext=1, int=0) -> `./src/heapDumpService.ts`
- `./state/AppStateCompat.js` (ext=1, int=0) -> `./src/state/AppStateCompat.ts`
- `./state/hostSessionState.js` (ext=1, int=0) -> `./src/state/hostSessionState.ts`
- `./state/selectors.js` (ext=1, int=0) -> `./src/state/selectors.ts`
- `./context/mailbox.js` (ext=1, int=0) -> `./src/context/mailbox.tsx`
