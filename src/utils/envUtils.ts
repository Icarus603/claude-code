/**
 * V7 §10.3 facade — moved to `@claude-code/config/env/utils`.
 *
 * Also wires the ant-only `checkProtectedNamespace` probe into the package's
 * setter. USER_TYPE !== 'ant' short-circuits the probe inside the package so
 * external builds never hit the require().
 */

import { setCheckProtectedNamespaceFn } from '@claude-code/config/env/utils'

if (process.env.USER_TYPE === 'ant') {
  setCheckProtectedNamespaceFn(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    return (
      require('./protectedNamespace.js') as typeof import('./protectedNamespace.js')
    ).checkProtectedNamespace()
    /* eslint-enable @typescript-eslint/no-require-imports */
  })
}

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
