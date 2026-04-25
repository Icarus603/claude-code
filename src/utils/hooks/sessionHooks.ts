// Forward shim — canonical owner is packages/agent/hooks/sessionHooks.ts.
// Both versions had identical logic; only import notation differed.
// Module-level state (registries, caches, locks) must be a single instance.
export * from '@claude-code/agent/hooks/sessionHooks.js'
