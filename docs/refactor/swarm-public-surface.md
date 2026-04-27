# @claude-code/swarm — exports audit

**Total**: 13  |  Public: 9  |  Internal-only: 0  |  Dead: 2  |  Protected: 3

## Truly dead (safe to remove)

- `./commands/agents/agents.js` -> `./commands/agents/agents.tsx`
- `./commands/branch/branch.js` -> `./commands/branch/branch.ts`

## Internal-only (safe to remove after relativization)


## Protected entries (kept regardless of usage — V7 §9.11 / API contract)

- `.` (ext=60, int=0) -> `./src/index.ts`
- `./errors` (ext=0, int=0) -> `./src/errors.ts`
- `./testing` (ext=0, int=0) -> `./testing/index.ts`

## Public surface

- `.` (ext=60, int=0) -> `./src/index.ts`
- `./teammateState.js` (ext=28, int=0) -> `./src/teammateState.ts`
- `./teammateContext.js` (ext=10, int=0) -> `./src/teammateContext.ts`
- `./teamDiscovery.js` (ext=2, int=0) -> `./src/teamDiscovery.ts`
- `./install/installSwarmHost.js` (ext=2, int=0) -> `./src/install/installSwarmHost.ts`
- `./teammateContextAlias.js` (ext=1, int=0) -> `./src/teammateContextAlias.ts`
- `./adapters/appRuntime.js` (ext=1, int=0) -> `./src/adapters/appRuntime.ts`
- `./commands/agents/index.js` (ext=1, int=0) -> `./commands/agents/index.ts`
- `./commands/branch/index.js` (ext=1, int=0) -> `./commands/branch/index.ts`
