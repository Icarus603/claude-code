/**
 * V7 §7 — config owns the allowed setting sources state.
 *
 * Previously this lived on the src/bootstrap STATE singleton; per V7 §7
 * "config" is the canonical owner of settings source precedence so the state
 * lives next to the rules that consume it. src/bootstrap/state.ts now
 * delegates to this module to preserve the singleton invariant — there is
 * still exactly one allowedSettingSources value process-wide, just owned by
 * the right package.
 */

import type { SettingSource } from '../settings/constants.js'

const DEFAULT_ALLOWED_SETTING_SOURCES: SettingSource[] = [
  'userSettings',
  'projectSettings',
  'localSettings',
  'flagSettings',
  'policySettings',
]

let allowedSettingSources: SettingSource[] = DEFAULT_ALLOWED_SETTING_SOURCES

export function getAllowedSettingSources(): SettingSource[] {
  return allowedSettingSources
}

export function setAllowedSettingSources(sources: SettingSource[]): void {
  allowedSettingSources = sources
}
