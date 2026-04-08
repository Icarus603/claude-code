// Compatibility shim for Phase 3. Stop-hook orchestration now enters through
// @claude-code/agent/hooks; remove this shim once all src/* callers stop
// importing the legacy query-local path.

export { handleStopHooks } from '@claude-code/agent/hooks'
