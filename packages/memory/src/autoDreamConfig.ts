import { getInitialSettings } from '@claude-code/config/settings'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'

export function isAutoDreamEnabled(): boolean {
  const setting = getInitialSettings().autoDreamEnabled
  if (setting !== undefined) return setting
  const gb = getFeatureValue_CACHED_MAY_BE_STALE<{ enabled?: unknown } | null>(
    'tengu_onyx_plover',
    null,
  )
  return gb?.enabled === true
}
