/**
 * V7 §8.6 — privacy-related env gates (analytics / feedback survey disable).
 *
 * Moved from src/services/privacyConfig.ts. Returns booleans derived from
 * cloud-provider env flags and the installed telemetry policy.
 *
 * `isTelemetryDisabled` comes from `../privacy-level.ts` (to be added in the
 * same migration); for now it's stubbed to `false` — the dev/build-time
 * stubbed modules register file paths that return false anyway, matching
 * external-build DCE.
 */

import { isEnvTruthy } from './utils.js'

/**
 * Host-injected telemetry-disabled probe. Defaults to `false`.
 * Set by the host's privacy-level module.
 */
let _isTelemetryDisabled: () => boolean = () => false

export function setIsTelemetryDisabledFn(fn: () => boolean): void {
  _isTelemetryDisabled = fn
}

export function isTelemetryDisabledForPrivacyConfig(): boolean {
  return _isTelemetryDisabled()
}

export function isAnalyticsDisabled(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY) ||
    _isTelemetryDisabled()
  )
}
