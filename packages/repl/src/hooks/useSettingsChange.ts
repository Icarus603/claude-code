import { useCallback, useEffect } from 'react'
import { settingsChangeDetector } from '@claude-code/config/changeDetector'
import type { SettingSource } from '@claude-code/config/constants'
import { getSettings } from '@claude-code/config/settings'
import type { SettingsJson } from '@claude-code/config/types'

export function useSettingsChange(
  onChange: (source: SettingSource, settings: SettingsJson) => void,
): void {
  const handleChange = useCallback(
    (source: SettingSource) => {
      // Cache is already reset by the notifier (changeDetector.fanOut) —
      // resetting here caused N-way thrashing with N subscribers: each
      // cleared the cache, re-read from disk, then the next cleared again.
      const newSettings = getSettings()
      onChange(source, newSettings)
    },
    [onChange],
  )

  useEffect(
    () => settingsChangeDetector.subscribe(handleChange),
    [handleChange],
  )
}
