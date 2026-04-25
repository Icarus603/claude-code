// Forward shim — canonical owner is packages/shell/src/bash/prefix.ts.
// packages version adds optional `signal?: AbortSignal` parameter
// (backward-compatible). Different import paths but resolve to same modules.
export * from '@claude-code/shell/bash/prefix.js'
