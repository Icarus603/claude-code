import { getSdkBetas } from '../../bootstrap/state.js'
import { getGlobalConfig } from '@claude-code/config'
import { getContextWindowForModel } from '../../utils/context.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getMaxOutputTokensForModel } from '../api/claude.js'

import {
  getEffectiveContextWindowSize as getEffectiveContextWindowSizeImpl,
  getAutoCompactThreshold as getAutoCompactThresholdImpl,
  calculateTokenWarningState as calculateTokenWarningStateImpl,
  isMainThreadSource,
} from '../../../packages/agent/compaction/contextWindowManager.js'

export {
  AUTOCOMPACT_BUFFER_TOKENS,
  WARNING_THRESHOLD_BUFFER_TOKENS,
  ERROR_THRESHOLD_BUFFER_TOKENS,
  MANUAL_COMPACT_BUFFER_TOKENS,
  MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
} from '../../../packages/agent/compaction/contextWindowManager.js'

const deps = {
  getContextWindowSize: (model: string, betas: string[]) =>
    getContextWindowForModel(model, betas),
  getMaxOutputTokensForModel,
  getSdkBetas: () => getSdkBetas() ?? [],
  getEnv: (key: string) => process.env[key],
}

function isAutoCompactEnabled(): boolean {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) {
    return false
  }
  if (isEnvTruthy(process.env.DISABLE_AUTO_COMPACT)) {
    return false
  }
  return getGlobalConfig().autoCompactEnabled
}

export function getEffectiveContextWindowSize(model: string): number {
  return getEffectiveContextWindowSizeImpl(model, deps)
}

export function getAutoCompactThreshold(model: string): number {
  return getAutoCompactThresholdImpl(model, deps)
}

export function calculateTokenWarningState(
  tokenUsage: number,
  model: string,
): ReturnType<typeof calculateTokenWarningStateImpl> {
  return calculateTokenWarningStateImpl(
    tokenUsage,
    model,
    deps,
    isAutoCompactEnabled(),
  )
}

export { isMainThreadSource }
