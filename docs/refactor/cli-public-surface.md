# @claude-code/cli — exports audit

**Total**: 30  |  Public: 13  |  Internal-only: 0  |  Dead: 16  |  Protected: 2

## Truly dead (safe to remove)

- `./headless/sdk/session/utils/streamJsonStdoutGuard.js` -> `./src/headless/sdk/session/utils/streamJsonStdoutGuard.ts`
- `./headless/sdk/session/utils/streamlinedTransform.js` -> `./src/headless/sdk/session/utils/streamlinedTransform.ts`
- `./ndjsonSafeStringify.js` -> `./src/ndjsonSafeStringify.ts`
- `./bg.js` -> `./src/bg.ts`
- `./pluginLoader.js` -> `./src/pluginLoader.ts`
- `./remoteManagedSettings.js` -> `./src/remoteManagedSettings.ts`
- `./remoteIO.js` -> `./src/remoteIO.ts`
- `./entry/mcp.js` -> `./src/entry/mcp.ts`
- `./handlers/util.js` -> `./src/handlers/util.tsx`
- `./handlers/mcp.js` -> `./src/handlers/mcp.tsx`
- `./exit.js` -> `./src/exit.ts`
- `./rollback.js` -> `./src/rollback.ts`
- `./up.js` -> `./src/up.ts`
- `./utils/warningHandler.js` -> `./src/utils/warningHandler.ts`
- `./setup/setup.js` -> `./src/setup/setup.ts`
- `./ccshareResume.js` -> `./src/ccshareResume.ts`

## Internal-only (safe to remove after relativization)


## Protected entries (kept regardless of usage — V7 §9.11 / API contract)

- `.` (ext=3, int=0) -> `./src/index.ts`
- `./contracts` (ext=0, int=0) -> `./src/contracts.ts`

## Public surface

- `.` (ext=3, int=0) -> `./src/index.ts`
- `./transports/*.js` (ext=2, int=0) -> `./src/transports/*.ts`
- `./secureStorage/keychainPrefetch.js` (ext=2, int=0) -> `./src/secureStorage/keychainPrefetch.ts`
- `./ssh/createSSHSession.js` (ext=2, int=0) -> `./src/ssh/createSSHSession.ts`
- `./mcpServersHandlers.js` (ext=1, int=0) -> `./src/mcpServersHandlers.ts`
- `./structuredIO.js` (ext=1, int=0) -> `./src/structuredIO.ts`
- `./structuredIOHelper.js` (ext=1, int=0) -> `./src/structuredIOHelper.ts`
- `./handlers/*.js` (ext=1, int=0) -> `./src/handlers/*.ts`
- `./print.js` (ext=1, int=0) -> `./src/print.ts`
- `./commands/mcp/addCommand.js` (ext=1, int=0) -> `./src/commands/mcp/addCommand.ts`
- `./commands/mcp/xaaIdpCommand.js` (ext=1, int=0) -> `./src/commands/mcp/xaaIdpCommand.ts`
- `./commands/version.js` (ext=1, int=0) -> `./src/commands/version.ts`
- `./ssh/SSHSessionManager.js` (ext=1, int=0) -> `./src/ssh/SSHSessionManager.ts`
