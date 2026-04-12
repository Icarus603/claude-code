/**
 * Settings Sync Service
 *
 * Syncs user settings and memory files across Claude Code environments.
 *
 * - Interactive CLI: Uploads local settings to remote (incremental, only changed entries)
 * - CCR: Downloads remote settings to local before plugin installation
 *
 * Backend API: anthropic/anthropic#218817
 */

import { feature } from 'bun:bundle'
import axios from 'axios'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import pickBy from 'lodash-es/pickBy.js'
import { dirname } from 'path'
import { getConfigHostBindings, tryGetConfigHostBindings } from '../host.js'
import { getMemoryPath } from '../global/config.js'
import { markInternalWrite } from '../settings/internalWrites.js'
import { getSettingsFilePathForSource } from '../settings/settings.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'

// V7 §11.4 — inlined utilities (same as remote/index.ts)
function errorMessage(e: unknown): string { return e instanceof Error ? e.message : String(e) }
type AxiosErrorKind = 'network' | 'timeout' | 'http' | 'unknown'
function classifyAxiosError(e: unknown): { kind: AxiosErrorKind; status?: number; message: string } {
  const message = errorMessage(e)
  if (!e || typeof e !== 'object' || !('isAxiosError' in e)) return { kind: 'unknown', message }
  const ae = e as { code?: string; response?: { status?: number } }
  if (ae.code === 'ECONNABORTED') return { kind: 'timeout', message }
  if (!ae.response) return { kind: 'network', message }
  return { kind: 'http', status: ae.response.status, message }
}
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)) }
const BASE_RETRY_DELAY_MS = 500
function getRetryDelay(attempt: number, retryAfterHeader?: string | null, maxDelayMs = 32000): number {
  if (retryAfterHeader) { const s = parseInt(retryAfterHeader, 10); if (!isNaN(s)) return s * 1000 }
  const base = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1), maxDelayMs)
  return base + Math.random() * 0.25 * base
}
function getClaudeCodeUserAgent(): string { return `claude-code/${MACRO.VERSION}` }
import {
  type SettingsSyncFetchResult,
  type SettingsSyncUploadResult,
  SYNC_KEYS,
  UserSyncDataSchema,
} from './types.js'

const SETTINGS_SYNC_TIMEOUT_MS = 10000 // 10 seconds
const DEFAULT_MAX_RETRIES = 3
const MAX_FILE_SIZE_BYTES = 500 * 1024 // 500 KB per file (matches backend limit)

/**
 * Upload local settings to remote (interactive CLI only).
 * Called from main.tsx preAction.
 * Runs in background - caller should not await unless needed.
 */
export async function uploadUserSettingsInBackground(): Promise<void> {
  try {
    if (
      !feature('UPLOAD_USER_SETTINGS') ||
      !getFeatureValue_CACHED_MAY_BE_STALE(
        'tengu_enable_settings_sync_push',
        false,
      ) ||
      !getConfigHostBindings().isInteractive?.() ||
      !isUsingOAuth()
    ) {
      tryGetConfigHostBindings().logDiagnostics?.('info', 'settings_sync_upload_skipped')
      tryGetConfigHostBindings().logEvent?.('tengu_settings_sync_upload_skipped_ineligible', {})
      return
    }

    tryGetConfigHostBindings().logDiagnostics?.('info', 'settings_sync_upload_starting')
    const result = await fetchUserSettings()
    if (!result.success) {
      tryGetConfigHostBindings().logDiagnostics?.('warn', 'settings_sync_upload_fetch_failed')
      tryGetConfigHostBindings().logEvent?.('tengu_settings_sync_upload_fetch_failed', {})
      return
    }

    const projectId = await getConfigHostBindings().getRepoRemoteHash?.()
    const localEntries = await buildEntriesFromLocalFiles(projectId)
    const remoteEntries = result.isEmpty ? {} : result.data!.content.entries
    const changedEntries = pickBy(
      localEntries,
      (value, key) => remoteEntries[key] !== value,
    )

    const entryCount = Object.keys(changedEntries).length
    if (entryCount === 0) {
      tryGetConfigHostBindings().logDiagnostics?.('info', 'settings_sync_upload_no_changes')
      tryGetConfigHostBindings().logEvent?.('tengu_settings_sync_upload_skipped', {})
      return
    }

    const uploadResult = await uploadUserSettings(changedEntries)
    if (uploadResult.success) {
      tryGetConfigHostBindings().logDiagnostics?.('info', 'settings_sync_upload_success')
      tryGetConfigHostBindings().logEvent?.('tengu_settings_sync_upload_success', { entryCount })
    } else {
      tryGetConfigHostBindings().logDiagnostics?.('warn', 'settings_sync_upload_failed')
      tryGetConfigHostBindings().logEvent?.('tengu_settings_sync_upload_failed', { entryCount })
    }
  } catch {
    // Fail-open: log unexpected errors but don't block startup
    tryGetConfigHostBindings().logDiagnostics?.('error', 'settings_sync_unexpected_error')
  }
}

// Cached so the fire-and-forget at runHeadless entry and the await in
// installPluginsAndApplyMcpInBackground share one fetch.
let downloadPromise: Promise<boolean> | null = null

/** Test-only: clear the cached download promise between tests. */
export function _resetDownloadPromiseForTesting(): void {
  downloadPromise = null
}

/**
 * Download settings from remote for CCR mode.
 * Fired fire-and-forget at the top of print.ts runHeadless(); awaited in
 * installPluginsAndApplyMcpInBackground before plugin install. First call
 * starts the fetch; subsequent calls join it.
 * Returns true if settings were applied, false otherwise.
 */
export function downloadUserSettings(): Promise<boolean> {
  if (downloadPromise) {
    return downloadPromise
  }
  downloadPromise = doDownloadUserSettings()
  return downloadPromise
}

/**
 * Force a fresh download, bypassing the cached startup promise.
 * Called by /reload-plugins in CCR so mid-session settings changes
 * (enabledPlugins, extraKnownMarketplaces) pushed from the user's local
 * CLI are picked up before the plugin-cache sweep.
 *
 * No retries: user-initiated command, one attempt + fail-open. The user
 * can re-run /reload-plugins to retry. Startup path keeps DEFAULT_MAX_RETRIES.
 *
 * Caller is responsible for firing settingsChangeDetector.notifyChange
 * when this returns true — applyRemoteEntriesToLocal uses markInternalWrite
 * to suppress detection (correct for startup, but mid-session needs
 * applySettingsChange to run). Kept out of this module to avoid the
 * settingsSync → changeDetector cycle edge.
 */
export function redownloadUserSettings(): Promise<boolean> {
  downloadPromise = doDownloadUserSettings(0)
  return downloadPromise
}

async function doDownloadUserSettings(
  maxRetries = DEFAULT_MAX_RETRIES,
): Promise<boolean> {
  if (feature('DOWNLOAD_USER_SETTINGS')) {
    try {
      if (
        !getFeatureValue_CACHED_MAY_BE_STALE('tengu_strap_foyer', false) ||
        !isUsingOAuth()
      ) {
        tryGetConfigHostBindings().logDiagnostics?.('info', 'settings_sync_download_skipped')
        tryGetConfigHostBindings().logEvent?.('tengu_settings_sync_download_skipped', {})
        return false
      }

      tryGetConfigHostBindings().logDiagnostics?.('info', 'settings_sync_download_starting')
      const result = await fetchUserSettings(maxRetries)
      if (!result.success) {
        tryGetConfigHostBindings().logDiagnostics?.('warn', 'settings_sync_download_fetch_failed')
        tryGetConfigHostBindings().logEvent?.('tengu_settings_sync_download_fetch_failed', {})
        return false
      }

      if (result.isEmpty) {
        tryGetConfigHostBindings().logDiagnostics?.('info', 'settings_sync_download_empty')
        tryGetConfigHostBindings().logEvent?.('tengu_settings_sync_download_empty', {})
        return false
      }

      const entries = result.data!.content.entries
      const projectId = await getConfigHostBindings().getRepoRemoteHash?.()
      const entryCount = Object.keys(entries).length
      tryGetConfigHostBindings().logDiagnostics?.('info', 'settings_sync_download_applying', {
        entryCount,
      })
      await applyRemoteEntriesToLocal(entries, projectId)
      tryGetConfigHostBindings().logEvent?.('tengu_settings_sync_download_success', { entryCount })
      return true
    } catch {
      // Fail-open: log error but don't block CCR startup
      tryGetConfigHostBindings().logDiagnostics?.('error', 'settings_sync_download_error')
      tryGetConfigHostBindings().logEvent?.('tengu_settings_sync_download_error', {})
      return false
    }
  }
  return false
}

/**
 * Check if user is authenticated with first-party OAuth.
 * Required for settings sync in both CLI (upload) and CCR (download) modes.
 *
 * Only checks user:inference (not user:profile) — CCR's file-descriptor token
 * hardcodes scopes to ['user:inference'] only, so requiring profile would make
 * download a no-op there. Upload is independently guarded by getConfigHostBindings().isInteractive?.().
 */
// V7 §8.6 — auth/provider logic delegated to host binding
function isUsingOAuth(): boolean {
  const auth = getConfigHostBindings().getSettingsSyncAuth?.()
  return auth?.isEligible ?? false
}

function getSettingsSyncEndpoint(): string {
  const auth = getConfigHostBindings().getSettingsSyncAuth?.()
  return `${auth?.baseApiUrl ?? 'https://api.anthropic.com'}/api/claude_code/user_settings`
}

async function getSettingsSyncAuthHeaders(): Promise<{
  headers: Record<string, string>
  error?: string
}> {
  const auth = getConfigHostBindings().getSettingsSyncAuth?.()
  if (!auth) return { headers: {}, error: 'Auth binding not installed' }
  try {
    return { headers: await auth.getAuthHeaders() }
  } catch {
    return { headers: {}, error: 'Failed to get auth headers' }
  }
}

async function fetchUserSettingsOnce(): Promise<SettingsSyncFetchResult> {
  try {
    await getConfigHostBindings().getSettingsSyncAuth?.()?.refreshToken?.()

    const authHeaders = await getSettingsSyncAuthHeaders()
    if (authHeaders.error) {
      return {
        success: false,
        error: authHeaders.error,
        skipRetry: true,
      }
    }

    const headers: Record<string, string> = {
      ...authHeaders.headers,
      'User-Agent': getClaudeCodeUserAgent(),
    }

    const endpoint = getSettingsSyncEndpoint()
    const response = await axios.get(endpoint, {
      headers,
      timeout: SETTINGS_SYNC_TIMEOUT_MS,
      validateStatus: status => status === 200 || status === 404,
    })

    // 404 means no settings exist yet
    if (response.status === 404) {
      tryGetConfigHostBindings().logDiagnostics?.('info', 'settings_sync_fetch_empty')
      return {
        success: true,
        isEmpty: true,
      }
    }

    const parsed = UserSyncDataSchema().safeParse(response.data)
    if (!parsed.success) {
      tryGetConfigHostBindings().logDiagnostics?.('warn', 'settings_sync_fetch_invalid_format')
      return {
        success: false,
        error: 'Invalid settings sync response format',
      }
    }

    tryGetConfigHostBindings().logDiagnostics?.('info', 'settings_sync_fetch_success')
    return {
      success: true,
      data: parsed.data,
      isEmpty: false,
    }
  } catch (error) {
    const { kind, message } = classifyAxiosError(error)
    switch (kind) {
      case 'auth':
        return {
          success: false,
          error: 'Not authorized for settings sync',
          skipRetry: true,
        }
      case 'timeout':
        return { success: false, error: 'Settings sync request timeout' }
      case 'network':
        return { success: false, error: 'Cannot connect to server' }
      default:
        return { success: false, error: message }
    }
  }
}

async function fetchUserSettings(
  maxRetries = DEFAULT_MAX_RETRIES,
): Promise<SettingsSyncFetchResult> {
  let lastResult: SettingsSyncFetchResult | null = null

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    lastResult = await fetchUserSettingsOnce()

    if (lastResult.success) {
      return lastResult
    }

    if (lastResult.skipRetry) {
      return lastResult
    }

    if (attempt > maxRetries) {
      return lastResult
    }

    const delayMs = getRetryDelay(attempt)
    tryGetConfigHostBindings().logDiagnostics?.('info', 'settings_sync_retry', {
      attempt,
      maxRetries,
      delayMs,
    })
    await sleep(delayMs)
  }

  return lastResult!
}

async function uploadUserSettings(
  entries: Record<string, string>,
): Promise<SettingsSyncUploadResult> {
  try {
    await getConfigHostBindings().getSettingsSyncAuth?.()?.refreshToken?.()

    const authHeaders = await getSettingsSyncAuthHeaders()
    if (authHeaders.error) {
      return {
        success: false,
        error: authHeaders.error,
      }
    }

    const headers: Record<string, string> = {
      ...authHeaders.headers,
      'User-Agent': getClaudeCodeUserAgent(),
      'Content-Type': 'application/json',
    }

    const endpoint = getSettingsSyncEndpoint()
    const response = await axios.put(
      endpoint,
      { entries },
      {
        headers,
        timeout: SETTINGS_SYNC_TIMEOUT_MS,
      },
    )

    tryGetConfigHostBindings().logDiagnostics?.('info', 'settings_sync_uploaded', {
      entryCount: Object.keys(entries).length,
    })
    return {
      success: true,
      checksum: response.data?.checksum,
      lastModified: response.data?.lastModified,
    }
  } catch (error) {
    tryGetConfigHostBindings().logDiagnostics?.('warn', 'settings_sync_upload_error')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Try to read a file for sync, with size limit and error handling.
 * Returns null if file doesn't exist, is empty, or exceeds size limit.
 */
async function tryReadFileForSync(filePath: string): Promise<string | null> {
  try {
    const stats = await stat(filePath)
    if (stats.size > MAX_FILE_SIZE_BYTES) {
      tryGetConfigHostBindings().logDiagnostics?.('info', 'settings_sync_file_too_large')
      return null
    }

    const content = await readFile(filePath, 'utf8')
    // Check for empty/whitespace-only without allocating a trimmed copy
    if (!content || /^\s*$/.test(content)) {
      return null
    }

    return content
  } catch {
    return null
  }
}

async function buildEntriesFromLocalFiles(
  projectId: string | null,
): Promise<Record<string, string>> {
  const entries: Record<string, string> = {}

  // Global user settings
  const userSettingsPath = getSettingsFilePathForSource('userSettings')
  if (userSettingsPath) {
    const content = await tryReadFileForSync(userSettingsPath)
    if (content) {
      entries[SYNC_KEYS.USER_SETTINGS] = content
    }
  }

  // Global user memory
  const userMemoryPath = getMemoryPath('User')
  const userMemoryContent = await tryReadFileForSync(userMemoryPath)
  if (userMemoryContent) {
    entries[SYNC_KEYS.USER_MEMORY] = userMemoryContent
  }

  // Project-specific files (only if we have a project ID from git remote)
  if (projectId) {
    // Project local settings
    const localSettingsPath = getSettingsFilePathForSource('localSettings')
    if (localSettingsPath) {
      const content = await tryReadFileForSync(localSettingsPath)
      if (content) {
        entries[SYNC_KEYS.projectSettings(projectId)] = content
      }
    }

    // Project local memory
    const localMemoryPath = getMemoryPath('Local')
    const localMemoryContent = await tryReadFileForSync(localMemoryPath)
    if (localMemoryContent) {
      entries[SYNC_KEYS.projectMemory(projectId)] = localMemoryContent
    }
  }

  return entries
}

async function writeFileForSync(
  filePath: string,
  content: string,
): Promise<boolean> {
  try {
    const parentDir = dirname(filePath)
    if (parentDir) {
      await mkdir(parentDir, { recursive: true })
    }

    await writeFile(filePath, content, 'utf8')
    tryGetConfigHostBindings().logDiagnostics?.('info', 'settings_sync_file_written')
    return true
  } catch {
    tryGetConfigHostBindings().logDiagnostics?.('warn', 'settings_sync_file_write_failed')
    return false
  }
}

/**
 * Apply remote entries to local files (CCR pull pattern).
 * Only writes files that match expected keys.
 *
 * After writing, invalidates relevant caches:
 * - resetSettingsCache() for settings files
 * - getConfigHostBindings().clearMemoryFileCaches?.() for memory files (CLAUDE.md)
 */
async function applyRemoteEntriesToLocal(
  entries: Record<string, string>,
  projectId: string | null,
): Promise<void> {
  let appliedCount = 0
  let settingsWritten = false
  let memoryWritten = false

  // Helper to check size limit (defense-in-depth, matches backend limit)
  const exceedsSizeLimit = (content: string, _path: string): boolean => {
    const sizeBytes = Buffer.byteLength(content, 'utf8')
    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      tryGetConfigHostBindings().logDiagnostics?.('info', 'settings_sync_file_too_large', {
        sizeBytes,
        maxBytes: MAX_FILE_SIZE_BYTES,
      })
      return true
    }
    return false
  }

  // Apply global user settings
  const userSettingsContent = entries[SYNC_KEYS.USER_SETTINGS]
  if (userSettingsContent) {
    const userSettingsPath = getSettingsFilePathForSource('userSettings')
    if (
      userSettingsPath &&
      !exceedsSizeLimit(userSettingsContent, userSettingsPath)
    ) {
      // Mark as internal write to prevent spurious change detection
      markInternalWrite(userSettingsPath)
      if (await writeFileForSync(userSettingsPath, userSettingsContent)) {
        appliedCount++
        settingsWritten = true
      }
    }
  }

  // Apply global user memory
  const userMemoryContent = entries[SYNC_KEYS.USER_MEMORY]
  if (userMemoryContent) {
    const userMemoryPath = getMemoryPath('User')
    if (!exceedsSizeLimit(userMemoryContent, userMemoryPath)) {
      if (await writeFileForSync(userMemoryPath, userMemoryContent)) {
        appliedCount++
        memoryWritten = true
      }
    }
  }

  // Apply project-specific files (only if project ID matches)
  if (projectId) {
    const projectSettingsKey = SYNC_KEYS.projectSettings(projectId)
    const projectSettingsContent = entries[projectSettingsKey]
    if (projectSettingsContent) {
      const localSettingsPath = getSettingsFilePathForSource('localSettings')
      if (
        localSettingsPath &&
        !exceedsSizeLimit(projectSettingsContent, localSettingsPath)
      ) {
        // Mark as internal write to prevent spurious change detection
        markInternalWrite(localSettingsPath)
        if (await writeFileForSync(localSettingsPath, projectSettingsContent)) {
          appliedCount++
          settingsWritten = true
        }
      }
    }

    const projectMemoryKey = SYNC_KEYS.projectMemory(projectId)
    const projectMemoryContent = entries[projectMemoryKey]
    if (projectMemoryContent) {
      const localMemoryPath = getMemoryPath('Local')
      if (!exceedsSizeLimit(projectMemoryContent, localMemoryPath)) {
        if (await writeFileForSync(localMemoryPath, projectMemoryContent)) {
          appliedCount++
          memoryWritten = true
        }
      }
    }
  }

  // Invalidate caches so subsequent reads pick up new content
  if (settingsWritten) {
    resetSettingsCache()
  }
  if (memoryWritten) {
    getConfigHostBindings().clearMemoryFileCaches?.()
  }

  tryGetConfigHostBindings().logDiagnostics?.('info', 'settings_sync_applied', {
    appliedCount,
  })
}
