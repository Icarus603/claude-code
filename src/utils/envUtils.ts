// Forward shim — canonical owner is @claude-code/config/env/utils.
// The ant-only checkProtectedNamespace wiring previously here referenced
// a deleted protectedNamespace.ts stub (export {}); it was a no-op in
// external builds and broken in any build that imported envUtils, so
// the setter dance is dropped. The package default `() => false` stands.

export {
  getAWSRegion,
  getClaudeConfigHomeDir,
  getDefaultVertexRegion,
  getTeamsDir,
  getVertexRegionForModel,
  hasNodeOption,
  isBareMode,
  isEnvDefinedFalsy,
  isEnvTruthy,
  isInProtectedNamespace,
  isRunningOnHomespace,
  parseEnvVars,
  shouldMaintainProjectWorkingDir,
} from '@claude-code/config/env/utils'
