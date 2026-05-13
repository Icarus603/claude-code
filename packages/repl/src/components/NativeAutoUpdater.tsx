import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { logEvent } from '@claude-code/local-observability'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { logError } from '@claude-code/local-observability/logging'
import { useInterval } from 'usehooks-ts'
import { useUpdateNotification } from '../hooks/useUpdateNotification.js'
import { Box, Text } from '@anthropic/ink'
import type { AutoUpdaterResult } from '@claude-code/updater/autoUpdater.js'
import {
  getMaxVersion,
  getMaxVersionMessage,
} from '@claude-code/updater/autoUpdater.js'
import { isAutoUpdaterDisabled } from '@claude-code/config'
import {
  getLatestVersion,
  installLatest,
} from '@claude-code/updater/nativeInstaller/index.js'
import { isVersionNewer } from '@claude-code/config/semver'
import { getInitialSettings } from '@claude-code/config/settings'

/**
 * Categorize error messages for analytics
 */
function getErrorType(errorMessage: string): string {
  if (errorMessage.includes('timeout')) {
    return 'timeout'
  }
  if (errorMessage.includes('Checksum mismatch')) {
    return 'checksum_mismatch'
  }
  if (errorMessage.includes('ENOENT') || errorMessage.includes('not found')) {
    return 'not_found'
  }
  if (errorMessage.includes('EACCES') || errorMessage.includes('permission')) {
    return 'permission_denied'
  }
  if (errorMessage.includes('ENOSPC')) {
    return 'disk_full'
  }
  if (errorMessage.includes('npm')) {
    return 'npm_error'
  }
  if (
    errorMessage.includes('network') ||
    errorMessage.includes('ECONNREFUSED') ||
    errorMessage.includes('ENOTFOUND')
  ) {
    return 'network_error'
  }
  return 'unknown'
}

type Props = {
  isUpdating: boolean
  onChangeIsUpdating: (isUpdating: boolean) => void
  onAutoUpdaterResult: (autoUpdaterResult: AutoUpdaterResult | null) => void
  autoUpdaterResult: AutoUpdaterResult | null
  showSuccessMessage: boolean
  verbose: boolean
}

export function NativeAutoUpdater({
  isUpdating,
  onChangeIsUpdating,
  onAutoUpdaterResult,
  autoUpdaterResult,
  showSuccessMessage,
  verbose,
}: Props): React.ReactNode {
  const [versions, setVersions] = useState<{
    current?: string | null
    latest?: string | null
  }>({})
  const [maxVersionIssue, setMaxVersionIssue] = useState<string | null>(null)
  // 'checking' = querying GitHub for the latest tag.
  // 'downloading' = a newer version was found and the binary is being fetched.
  // null = idle (initial, between checks, or after success/failure).
  const [phase, setPhase] = useState<'checking' | 'downloading' | null>(null)
  const updateSemver = useUpdateNotification(autoUpdaterResult?.version)
  const channel = getInitialSettings()?.autoUpdatesChannel ?? 'latest'

  // Track latest isUpdating value in a ref so the memoized checkForUpdates
  // callback always sees the current value without changing callback identity
  // (which would re-trigger the initial-check useEffect below and cause
  // repeated downloads on remount — the upstream trigger for #22413).
  const isUpdatingRef = useRef(isUpdating)
  isUpdatingRef.current = isUpdating

  // The 30-minute interval re-runs checkForUpdates indefinitely; we only want
  // to flash "Checking for updates" on the first mount-time check so the
  // background polling doesn't keep nagging the footer. Subsequent runs go
  // straight to either silent (no new version) or 'downloading' (new version
  // found).
  const isFirstCheckRef = useRef(true)

  const checkForUpdates = React.useCallback(async () => {
    if (isUpdatingRef.current) {
      return
    }

    if (
      process.env.NODE_ENV === 'test' ||
      process.env.NODE_ENV === 'development'
    ) {
      logForDebugging(
        'NativeAutoUpdater: Skipping update check in test/dev environment',
      )
      return
    }

    if (isAutoUpdaterDisabled()) {
      return
    }

    onChangeIsUpdating(true)
    if (isFirstCheckRef.current) {
      setPhase('checking')
    }
    const startTime = Date.now()

    // Log the start of an auto-update check for funnel analysis
    logEvent('tengu_native_auto_updater_start', {})

    try {
      // Surface the maxVersion banner message to the UI when current
      // version exceeds the cap. The actual force-downgrade decision
      // and `tengu_native_update_forced_downgrade` telemetry are
      // emitted inside installer.ts:updateLatest (port of ant `UV5`)
      // — fired once when the install starts, not on every cron tick.
      const maxVersion = await getMaxVersion()
      if (maxVersion && isVersionNewer(MACRO.VERSION, maxVersion)) {
        const msg = await getMaxVersionMessage()
        setMaxVersionIssue(msg ?? 'affects your version')
      }

      // Peek at the latest tag before kicking off installLatest so we can
      // distinguish "checking" from "downloading" in the footer. installLatest
      // will fetch this again internally — that's a tiny JSON request and the
      // in-flight dedup means no double-download. If the peek fails for any
      // reason we just fall through; installLatest's own error handling takes
      // over.
      try {
        const latest = await getLatestVersion(channel)
        if (latest && isVersionNewer(latest, MACRO.VERSION)) {
          setPhase('downloading')
        }
      } catch {
        // Swallow — installLatest will surface the real error
      }

      const result = await installLatest(channel)
      const currentVersion = MACRO.VERSION
      const latencyMs = Date.now() - startTime

      // Handle lock contention gracefully - just return without treating as error
      if (result.lockFailed) {
        logEvent('tengu_native_auto_updater_lock_contention', {
          latency_ms: latencyMs,
        })
        return // Silently skip this update check, will try again later
      }

      // Update versions for display
      setVersions({ current: currentVersion, latest: result.latestVersion })

      if (result.wasUpdated) {
        logEvent('tengu_native_auto_updater_success', {
          latency_ms: latencyMs,
        })

        onAutoUpdaterResult({
          version: result.latestVersion,
          status: 'success',
        })
      } else {
        // Already up to date
        logEvent('tengu_native_auto_updater_up_to_date', {
          latency_ms: latencyMs,
        })
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      logError(error)

      const errorType = getErrorType(errorMessage)
      logEvent('tengu_native_auto_updater_fail', {
        latency_ms: latencyMs,
        error_timeout: errorType === 'timeout',
        error_checksum: errorType === 'checksum_mismatch',
        error_not_found: errorType === 'not_found',
        error_permission: errorType === 'permission_denied',
        error_disk_full: errorType === 'disk_full',
        error_npm: errorType === 'npm_error',
        error_network: errorType === 'network_error',
      })

      onAutoUpdaterResult({
        version: null,
        status: 'install_failed',
      })
    } finally {
      onChangeIsUpdating(false)
      setPhase(null)
      isFirstCheckRef.current = false
    }
    // isUpdating intentionally omitted from deps; we read isUpdatingRef
    // instead so the guard is always current without changing callback
    // identity (which would re-trigger the initial-check useEffect below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onAutoUpdaterResult, channel])

  // Initial check
  useEffect(() => {
    void checkForUpdates()
  }, [checkForUpdates])

  // Check every 30 minutes
  useInterval(checkForUpdates, 30 * 60 * 1000)

  const hasUpdateResult = !!autoUpdaterResult?.version
  // Show the component when:
  // - warning banner needed (above max version), or
  // - there's an update result to display (success/error), or
  // - we have a phase to surface ('checking' on first mount, 'downloading'
  //   whenever a real update is in flight). Background interval checks with
  //   no update available leave phase=null and stay silent.
  const shouldRender = !!maxVersionIssue || hasUpdateResult || phase !== null

  if (!shouldRender) {
    return null
  }

  return (
    <Box flexDirection="row" gap={1}>
      {verbose && (
        <Text dimColor wrap="truncate">
          current: {versions.current} &middot; {channel}: {versions.latest}
        </Text>
      )}
      {phase !== null ? (
        <Box>
          <Text dimColor wrap="truncate">
            {phase === 'downloading' ? 'Auto-updating…' : 'Checking for updates'}
          </Text>
        </Box>
      ) : (
        autoUpdaterResult?.status === 'success' &&
        showSuccessMessage &&
        updateSemver && (
          <Text color="success" wrap="truncate">
            ✓ Update installed · Restart to update
          </Text>
        )
      )}
      {autoUpdaterResult?.status === 'install_failed' && (
        <Text color="error" wrap="truncate">
          ✗ Auto-update failed &middot; Try <Text bold>/status</Text>
        </Text>
      )}
      {maxVersionIssue && process.env.USER_TYPE === 'ant' && (
        <Text color="warning">
          ⚠ Known issue: {maxVersionIssue} &middot; Run{' '}
          <Text bold>claude rollback --safe</Text> to downgrade
        </Text>
      )}
    </Box>
  )
}
