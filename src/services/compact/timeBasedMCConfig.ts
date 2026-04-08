import { getFeatureValue_CACHED_MAY_BE_STALE } from '../featureFlags.js'

export type { TimeBasedMCConfig } from '../../../packages/agent/types/compaction.js'

import {
  getTimeBasedMCConfig as getTimeBasedMCConfigImpl,
} from '../../../packages/agent/compaction/timeBasedMCConfig.js'

export function getTimeBasedMCConfig() {
  return getTimeBasedMCConfigImpl({
    getFeatureValue: getFeatureValue_CACHED_MAY_BE_STALE,
  })
}
