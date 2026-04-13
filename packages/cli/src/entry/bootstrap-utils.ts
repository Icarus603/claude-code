/**
 * Bootstrap utilities extracted from src/main.tsx.
 * These pure helpers are used during CLI startup and are safe to import
 * from @claude-code/cli without triggering circular dependencies.
 *
 * Moved from src/main.tsx per V7 Phase 4 cut-A.
 */

import { SHOW_CURSOR } from '@anthropic/ink'
import { isRunningWithBun } from '../../../../src/utils/bundledMode.js'
import {
  getManagedSettingsKeysForLogging,
  getSettingsForSource,
} from '../../../../src/utils/settings/settings.js'
import { logEvent } from '@claude-code/local-observability'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '@claude-code/local-observability/compat'

// Lazy require to avoid circular dependency: teammate.ts -> AppState.tsx -> ... -> main.tsx
/* eslint-disable @typescript-eslint/no-require-imports */
export const getTeammateModeSnapshot = () =>
  require('@claude-code/swarm') as typeof import('@claude-code/swarm')
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Log managed settings keys to Statsig for analytics.
 * This is called after init() completes to ensure settings are loaded
 * and environment variables are applied before model resolution.
 */
export function logManagedSettings(): void {
  try {
    const policySettings = getSettingsForSource('policySettings')
    if (policySettings) {
      const allKeys = getManagedSettingsKeysForLogging(policySettings)
      logEvent('tengu_managed_settings_loaded', {
        keyCount: allKeys.length,
        keys: allKeys.join(
          ',',
        ) as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
  } catch {
    // Silently ignore errors - this is just for analytics
  }
}

// Check if running in debug/inspection mode
export function isBeingDebugged() {
  const isBun = isRunningWithBun()

  // Check for inspect flags in process arguments (including all variants)
  const hasInspectArg = process.execArgv.some((arg) => {
    if (isBun) {
      // Note: Bun has an issue with single-file executables where application arguments
      // from process.argv leak into process.execArgv (similar to https://github.com/oven-sh/bun/issues/11673)
      // This breaks use of --debug mode if we omit this branch
      // We're fine to skip that check, because Bun doesn't support Node.js legacy --debug or --debug-brk flags
      return /--inspect(-brk)?/.test(arg)
    } else {
      // In Node.js, check for both --inspect and legacy --debug flags
      return /--inspect(-brk)?|--debug(-brk)?/.test(arg)
    }
  })

  // Check if NODE_OPTIONS contains inspect flags
  const hasInspectEnv =
    process.env.NODE_OPTIONS &&
    /--inspect(-brk)?|--debug(-brk)?/.test(process.env.NODE_OPTIONS)

  // Check if inspector is available and active (indicates debugging)
  try {
    // Dynamic import would be better but is async - use global object instead
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inspector = (global as any).require('inspector')
    const hasInspectorUrl = !!inspector.url()
    return hasInspectorUrl || hasInspectArg || hasInspectEnv
  } catch {
    // Ignore error and fall back to argument detection
    return hasInspectArg || hasInspectEnv
  }
}

/**
 * Write SHOW_CURSOR to whichever stream is currently a TTY so that a killed
 * Ink render doesn't leave the terminal cursor hidden. Installed as a
 * `process.on('exit', ...)` handler during CLI bootstrap.
 */
export function resetCursor(): void {
  const terminal = process.stderr.isTTY
    ? process.stderr
    : process.stdout.isTTY
      ? process.stdout
      : undefined
  terminal?.write(SHOW_CURSOR)
}
