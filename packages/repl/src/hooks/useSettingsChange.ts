import { useCallback, useEffect } from 'react'
import { settingsChangeDetector } from 'src/utils/settings/changeDetector.js'
import type { SettingSource } from 'src/utils/settings/constants.js'
import { getSettings_DEPRECATED } from 'src/utils/settings/settings.js'
import type { SettingsJson } from 'src/utils/settings/types.js'

export function useSettingsChange(
  onChange: (source: SettingSource, settings: SettingsJson) => void,
): void {
  const handleChange = useCallback(
    (source: SettingSource) => {
      // Cache is already reset by the notifier (changeDetector.fanOut) —
      // resetting here caused N-way thrashing with N subscribers: each
      // cleared the cache, re-read from disk, then the next cleared again.
      const newSettings = getSettings_DEPRECATED()
      onChange(source, newSettings)
    },
    [onChange],
  )

  useEffect(
    () => settingsChangeDetector.subscribe(handleChange),
    [handleChange],
  )
}
