import { getInitialSettings } from '../../../src/utils/settings/settings.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../../src/services/featureFlags.js'

export function isAutoDreamEnabled(): boolean {
  const setting = getInitialSettings().autoDreamEnabled
  if (setting !== undefined) return setting
  const gb = getFeatureValue_CACHED_MAY_BE_STALE<{ enabled?: unknown } | null>(
    'tengu_onyx_plover',
    null,
  )
  return gb?.enabled === true
}
