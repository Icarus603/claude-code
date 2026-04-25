// Forward shim — canonical owner is packages/cli/src/headless/sdk/session/utils/streamlinedTransform.ts.
// Both versions had the same logic; only the import notation differed (src/* vs @claude-code/*).
// Consolidating ensures both consumers (run.ts and run-streaming.ts) share one module instance.
export * from '@claude-code/cli/headless/sdk/session/utils/streamlinedTransform.js'
