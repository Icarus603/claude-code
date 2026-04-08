/**
 *
 */

import type { TimeBasedMCConfig } from '../types/compaction.js'


export interface TimeBasedMCConfigDeps {
  getFeatureValue<T>(key: string, defaultValue: T): T
}


export const TIME_BASED_MC_CONFIG_DEFAULTS: TimeBasedMCConfig = {
  enabled: false,
  gapThresholdMinutes: 60,
  keepRecent: 5,
}


/**
 */
export function getTimeBasedMCConfig(deps: TimeBasedMCConfigDeps): TimeBasedMCConfig {
  // Hoist the GB read so exposure fires on every eval path
  return deps.getFeatureValue<TimeBasedMCConfig>(
    'tengu_slate_heron',
    TIME_BASED_MC_CONFIG_DEFAULTS,
  )
}
