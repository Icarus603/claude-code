import { tryGetConfigHostBindings } from '../host.js'
import type { SettingSource } from './constants.js'
import { getInitialSettings } from './settings.js'

/**
 * Minimal structural type for the state slice that applySettingsChange reads
 * and updates. The full AppState is owned by app-host; config only needs these
 * three fields plus an open index signature for the spread-back.
 *
 * V7 §7.2 — AppState is not a terminal owner; config cannot import it directly.
 */
type SettingsChangeTarget = {
  toolPermissionContext: unknown
  settings: { effortLevel?: unknown }
  effortValue?: unknown
  [key: string]: unknown
}

/**
 * Apply a settings change to app state. Re-reads settings from disk,
 * reloads permissions and hooks, and pushes the new state.
 *
 * Used by both the interactive path (AppState.tsx via useSettingsChange) and
 * the headless/SDK path (print.ts direct subscribe) so that managed-settings
 * / policy changes are fully applied in both modes.
 *
 * The settings cache is reset by the notifier (changeDetector.fanOut) before
 * listeners are iterated, so getInitialSettings() here reads fresh disk
 * state. Previously this function reset the cache itself, which — combined
 * with useSettingsChange's own reset — caused N disk reloads per notification
 * for N subscribers.
 *
 * Side-effects like clearing auth caches and applying env vars are handled by
 * `onChangeAppState` which fires when `settings` changes in state.
 */
export function applySettingsChange(
  source: SettingSource,
  setAppState: (f: (prev: SettingsChangeTarget) => SettingsChangeTarget) => void,
): void {
  const bindings = tryGetConfigHostBindings()
  const newSettings = getInitialSettings()

  bindings.logDebug?.(`Settings changed from ${source}, updating app state`)

  const updatedRules = bindings.loadAllPermissionRulesFromDisk?.() ?? []
  bindings.updateHooksConfigSnapshot?.()

  setAppState(prev => {
    const newContext = bindings.reconcilePermissionContext?.(prev.toolPermissionContext, updatedRules) ?? prev.toolPermissionContext

    // Sync effortLevel from settings to top-level AppState when it changes
    // (e.g. via applyFlagSettings from IDE). Only propagate if the setting
    // itself changed — otherwise unrelated settings churn (e.g. tips dismissal
    // on startup) would clobber a --effort CLI flag value held in AppState.
    const prevEffort = prev.settings.effortLevel
    const newEffort = newSettings.effortLevel
    const effortChanged = prevEffort !== newEffort

    return {
      ...prev,
      settings: newSettings,
      toolPermissionContext: newContext,
      // Only propagate a defined new value — when the disk key is absent
      // (e.g. /effort max for non-ants writes undefined; --effort CLI flag),
      // prev.settings.effortLevel can be stale (internal writes suppress the
      // watcher that would resync AppState.settings), so effortChanged would
      // be true and we'd wipe a session-scoped value held in effortValue.
      ...(effortChanged && newEffort !== undefined
        ? { effortValue: newEffort }
        : {}),
    }
  })
}
