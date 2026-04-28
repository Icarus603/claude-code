# @claude-code/server — exports audit

**Total**: 7  |  Public: 3  |  Internal-only: 0  |  Dead: 1  |  Protected: 4

## Truly dead (safe to remove)

- `./upstreamproxy/relay.js` -> `./src/upstreamproxy/relay.ts`

## Internal-only (safe to remove after relativization)


## Protected entries (kept regardless of usage — V7 §9.11 / API contract)

- `.` (ext=1, int=0) -> `./src/index.ts`
- `./contracts` (ext=0, int=0) -> `./src/contracts.ts`
- `./errors` (ext=0, int=0) -> `./src/errors.ts`
- `./testing` (ext=0, int=0) -> `./testing/index.ts`

## Public surface

- `./*.js` (ext=9, int=0) -> `./src/*.ts`
- `.` (ext=1, int=0) -> `./src/index.ts`
- `./upstreamproxy/upstreamproxy.js` (ext=1, int=0) -> `./src/upstreamproxy/upstreamproxy.ts`
