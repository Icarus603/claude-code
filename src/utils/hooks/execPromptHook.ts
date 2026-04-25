// Forward shim — canonical owner is packages/agent/hooks/execPromptHook.ts.
// Both versions had identical logic; only import notation differed.
// Module-level state (registries, caches, locks) must be a single instance.
export * from '@claude-code/agent/hooks/execPromptHook.js'
