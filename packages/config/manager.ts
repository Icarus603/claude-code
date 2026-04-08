/**
 * SettingsManager — Unified configuration management interface
 *
 * Provides a single entry point for reading/writing both Settings (multi-layer,
 * priority-merged) and GlobalConfig (user preferences, OAuth, etc.).
 *
 * Phase 1: Delegates to existing settings/config modules.
 * Phase 2+: Will own the implementation directly after code migration.
 */

import { getGlobalConfig, saveGlobalConfig, type GlobalConfig } from './global/config.js'
import {
  getInitialSettings,
  getSettingsForSource,
  getSettingsWithSources,
  getSettingsWithErrors,
  updateSettingsForSource,
  getSettingsFilePathForSource,
  type SettingsJson,
} from './settings/settings.js'
import {
  type EditableSettingSource,
  type SettingSource,
  getEnabledSettingSources,
} from './settings/constants.js'
import { subscribeToSettingsChanges } from './index.js'

/** Unsubscribe function returned by watch() */
type Unsubscribe = () => void

/**
 * SettingsManager — reads merged settings, writes to a specific source,
 * and supports change watching.
 *
 * Design notes:
 * - get() returns the priority-merged effective value
 * - set() writes to a specific source (userSettings by default)
 * - watch() fires when ANY source changes (via changeDetector signal)
 */
export const SettingsManager = {
  // ── Settings (multi-layer priority-merged) ──────────────────────

  /**
   * Get a single key from the effective merged settings.
   * Returns `undefined` if the key is not set in any layer.
   */
  get<K extends keyof SettingsJson>(key: K): SettingsJson[K] {
    const settings = getInitialSettings()
    return settings[key]
  },

  /**
   * Get all effective merged settings.
   */
  getAll(): SettingsJson {
    return getInitialSettings()
  },

  /**
   * Set a key in a specific settings source.
   * By default writes to the user-level settings (~/.claude/settings.json).
   */
  set<K extends keyof SettingsJson>(
    key: K,
    value: SettingsJson[K],
    source: EditableSettingSource = 'userSettings',
  ): { error: Error | null } {
    return updateSettingsForSource(source, { [key]: value } as Partial<SettingsJson> as SettingsJson)
  },

  /**
   * Get the raw settings for a specific source layer.
   */
  getForSource(source: SettingSource): SettingsJson | null {
    const result = getSettingsForSource(source)
    return result.settings || null
  },

  /**
   * Get all enabled source layers with their raw settings, ordered low→high priority.
   */
  getSources(): Array<{ source: SettingSource; settings: SettingsJson }> {
    return getSettingsWithSources().sources
  },

  /**
   * Watch for changes to a specific settings key.
   * The callback fires whenever ANY source layer changes (we cannot
   * distinguish per-key at the file-watcher level).
   *
   * Returns an unsubscribe function.
   */
  watch<K extends keyof SettingsJson>(
    key: K,
    callback: (newValue: SettingsJson[K], source: SettingSource) => void,
  ): Unsubscribe {
    return subscribeToSettingsChanges((changedSource) => {
      const newValue = SettingsManager.get(key)
      callback(newValue, changedSource)
    })
  },

  /**
   * Get settings with validation errors included.
   */
  getWithErrors() {
    return getSettingsWithErrors()
  },

  /**
   * Get the file path for a given settings source.
   */
  getFilePath(source: SettingSource): string | null {
    return getSettingsFilePathForSource(source)
  },

  // ── GlobalConfig (single-file user preferences) ─────────────────

  /**
   * Read the global config (~/.claude.json).
   */
  getGlobalConfig(): GlobalConfig {
    return getGlobalConfig()
  },

  /**
   * Update the global config. Receives the current config and must return
   * the new config (immutable update pattern).
   */
  saveGlobalConfig(updater: (current: GlobalConfig) => GlobalConfig): void {
    saveGlobalConfig(updater)
  },
} as const
