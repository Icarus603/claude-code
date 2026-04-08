import { getFeatureValue_CACHED_MAY_BE_STALE } from '../featureFlags.js'

export type { CachedMCConfig } from '../../../packages/agent/types/compaction.js'

export {
  DEFAULT_CACHED_MC_CONFIG,
} from '../../../packages/agent/compaction/cachedMCConfig.js'

import {
  getCachedMCConfig as getCachedMCConfigImpl,
} from '../../../packages/agent/compaction/cachedMCConfig.js'

export function getCachedMCConfig() {
  return getCachedMCConfigImpl({
    getFeatureValue: getFeatureValue_CACHED_MAY_BE_STALE,
    getEnv: (key: string) => process.env[key],
  })
}
