// Forward shim — canonical owner is packages/agent/queryContext.ts.
// Both versions had identical logic; only import notation and a relaxed AppState type differed.
// Note: agentHostBindings.ts and packageHostSetupOrchestrator.ts still use require('src/utils/queryContext.js')
// — those resolve through this shim now (single module instance).
export * from '@claude-code/agent/queryContext.js'
