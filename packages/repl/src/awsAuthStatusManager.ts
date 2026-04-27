// Canonical owner is @claude-code/provider/awsAuthStatusManager.
// Moved 2026-04-27 to break a provider→repl back-edge in the 154-file SCC.
// Singleton identity preserved — both shim and canonical paths resolve to
// the same module via Bun's import resolution.
export {
  AwsAuthStatusManager,
  type AwsAuthStatus,
} from '@claude-code/provider/awsAuthStatusManager.js'
