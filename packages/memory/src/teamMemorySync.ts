/**
 * Team Memory Sync Service
 *
 * Syncs team memory files between the local filesystem and the server API.
 * Team memory is scoped per-repo (identified by git remote hash) and shared
 * across all authenticated org members.
 *
 * API contract (anthropic/anthropic#250711 + #283027):
 *   GET  /api/claude_code/team_memory?repo={owner/repo}            → TeamMemoryData (includes entryChecksums)
 *   GET  /api/claude_code/team_memory?repo={owner/repo}&view=hashes → metadata + entryChecksums only (no entry bodies)
 *   PUT  /api/claude_code/team_memory?repo={owner/repo}            → upload entries (upsert semantics)
 *   404 = no data exists yet
 *
 * V7 §8 — memory is Wave 2. All cross-layer deps go through MemoryHostBindings.
 */

import axios from 'axios'
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { join, relative, sep } from 'path'
import {
  getTeamMemPath,
  PathTraversalError,
  validateTeamMemKey,
} from './teamMemPaths.js'
import { getMemoryHostBindings } from './host.js'
import {
  count,
  classifyAxiosError,
  sleep,
  getRetryDelay,
  jsonStringify,
  sha256Hex,
} from './internalUtils.js'
import {
  TeamMemoryDataSchema,
  TeamMemoryTooManyEntriesSchema,
  type SkippedSecretFile,
  type TeamMemorySyncFetchResult,
  type TeamMemoryHashesResult,
  type TeamMemorySyncPushResult,
  type TeamMemorySyncUploadResult,
} from './teamMemTypes.js'

const TEAM_MEMORY_SYNC_TIMEOUT_MS = 30_000
const MAX_FILE_SIZE_BYTES = 250_000
const MAX_PUT_BODY_BYTES = 200_000
const MAX_RETRIES = 3
const MAX_CONFLICT_RETRIES = 2

// ─── Sync state ─────────────────────────────────────────────

export type SyncState = {
  lastKnownChecksum: string | null
  serverChecksums: Map<string, string>
  serverMaxEntries: number | null
}

export function createSyncState(): SyncState {
  return {
    lastKnownChecksum: null,
    serverChecksums: new Map(),
    serverMaxEntries: null,
  }
}

export function hashContent(content: string): string {
  return sha256Hex(content)
}

function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && 'code' in e && typeof e.code === 'string'
}

// ─── Auth & endpoint ─────────────────────────────────────────

function isUsingOAuth(): boolean {
  const bindings = getMemoryHostBindings()
  if (
    bindings.getAPIProvider?.() !== 'firstParty' ||
    !(bindings.isFirstPartyAnthropicBaseUrl?.() ?? false)
  ) {
    return false
  }
  const tokens = bindings.getClaudeAIOAuthTokens?.()
  const inferenceScope = bindings.claudeAiInferenceScope ?? 'api'
  const profileScope = bindings.claudeAiProfileScope ?? 'openid'
  return Boolean(
    tokens?.accessToken &&
      tokens.scopes?.includes(inferenceScope) &&
      tokens.scopes.includes(profileScope),
  )
}

function getTeamMemorySyncEndpoint(repoSlug: string): string {
  const bindings = getMemoryHostBindings()
  const baseUrl =
    process.env.TEAM_MEMORY_SYNC_URL ?? (bindings.oauthBaseApiUrl ?? 'https://claude.ai')
  return `${baseUrl}/api/claude_code/team_memory?repo=${encodeURIComponent(repoSlug)}`
}

function getAuthHeaders(): {
  headers?: Record<string, string>
  error?: string
} {
  const bindings = getMemoryHostBindings()
  const oauthTokens = bindings.getClaudeAIOAuthTokens?.()
  if (oauthTokens?.accessToken) {
    return {
      headers: {
        Authorization: `Bearer ${oauthTokens.accessToken}`,
        'anthropic-beta': bindings.oauthBetaHeader ?? '',
        'User-Agent': bindings.getClaudeCodeUserAgent?.() ?? 'claude-code',
      },
    }
  }
  return { error: 'No OAuth token available for team memory sync' }
}

// ─── Fetch (pull) ────────────────────────────────────────────

async function fetchTeamMemoryOnce(
  state: SyncState,
  repoSlug: string,
  etag?: string | null,
): Promise<TeamMemorySyncFetchResult> {
  const bindings = getMemoryHostBindings()
  try {
    await bindings.checkAndRefreshOAuthTokenIfNeeded?.()

    const auth = getAuthHeaders()
    if (auth.error) {
      return {
        success: false,
        error: auth.error,
        skipRetry: true,
        errorType: 'auth',
      }
    }

    const headers: Record<string, string> = { ...auth.headers }
    if (etag) {
      headers['If-None-Match'] = `"${etag.replace(/"/g, '')}"`
    }

    const endpoint = getTeamMemorySyncEndpoint(repoSlug)
    const response = await axios.get(endpoint, {
      headers,
      timeout: TEAM_MEMORY_SYNC_TIMEOUT_MS,
      validateStatus: status =>
        status === 200 || status === 304 || status === 404,
    })

    if (response.status === 304) {
      bindings.logDebug?.('team-memory-sync: not modified (304)', {
        level: 'debug',
      })
      return { success: true, notModified: true, checksum: etag ?? undefined }
    }

    if (response.status === 404) {
      bindings.logDebug?.('team-memory-sync: no remote data (404)', {
        level: 'debug',
      })
      state.lastKnownChecksum = null
      return { success: true, isEmpty: true }
    }

    const parsed = TeamMemoryDataSchema().safeParse(response.data)
    if (!parsed.success) {
      bindings.logDebug?.('team-memory-sync: invalid response format', {
        level: 'warn',
      })
      return {
        success: false,
        error: 'Invalid team memory response format',
        skipRetry: true,
        errorType: 'parse',
      }
    }

    const responseChecksum =
      parsed.data.checksum ||
      response.headers['etag']?.replace(/^"|"$/g, '') ||
      undefined
    if (responseChecksum) {
      state.lastKnownChecksum = responseChecksum
    }

    bindings.logDebug?.(
      `team-memory-sync: fetched successfully (checksum: ${responseChecksum ?? 'none'})`,
      { level: 'debug' },
    )
    return {
      success: true,
      data: parsed.data,
      isEmpty: false,
      checksum: responseChecksum,
    }
  } catch (error) {
    const { kind, status, message } = classifyAxiosError(error)
    const body = axios.isAxiosError(error)
      ? JSON.stringify(error.response?.data ?? '')
      : ''
    if (kind !== 'other') {
      bindings.logDebug?.(`team-memory-sync: fetch error ${status}: ${body}`, {
        level: 'warn',
      })
    }
    switch (kind) {
      case 'auth':
        return {
          success: false,
          error: `Not authorized for team memory sync: ${body}`,
          skipRetry: true,
          errorType: 'auth',
          httpStatus: status,
        }
      case 'timeout':
        return {
          success: false,
          error: 'Team memory sync request timeout',
          errorType: 'timeout',
        }
      case 'network':
        return {
          success: false,
          error: 'Cannot connect to server',
          errorType: 'network',
        }
      default:
        return {
          success: false,
          error: message,
          errorType: 'unknown',
          httpStatus: status,
        }
    }
  }
}

async function fetchTeamMemoryHashes(
  state: SyncState,
  repoSlug: string,
): Promise<TeamMemoryHashesResult> {
  const bindings = getMemoryHostBindings()
  try {
    await bindings.checkAndRefreshOAuthTokenIfNeeded?.()
    const auth = getAuthHeaders()
    if (auth.error) {
      return { success: false, error: auth.error, errorType: 'auth' }
    }

    const endpoint = getTeamMemorySyncEndpoint(repoSlug) + '&view=hashes'
    const response = await axios.get(endpoint, {
      headers: auth.headers,
      timeout: TEAM_MEMORY_SYNC_TIMEOUT_MS,
      validateStatus: status => status === 200 || status === 404,
    })

    if (response.status === 404) {
      state.lastKnownChecksum = null
      return { success: true, entryChecksums: {} }
    }

    const checksum =
      response.data?.checksum || response.headers['etag']?.replace(/^"|"$/g, '')
    const entryChecksums = response.data?.entryChecksums

    if (!entryChecksums || typeof entryChecksums !== 'object') {
      return {
        success: false,
        error:
          'Server did not return entryChecksums (?view=hashes unsupported)',
        errorType: 'parse',
      }
    }

    if (checksum) {
      state.lastKnownChecksum = checksum
    }
    return {
      success: true,
      version: response.data?.version,
      checksum,
      entryChecksums,
    }
  } catch (error) {
    const { kind, status, message } = classifyAxiosError(error)
    switch (kind) {
      case 'auth':
        return {
          success: false,
          error: 'Not authorized',
          errorType: 'auth',
          httpStatus: status,
        }
      case 'timeout':
        return { success: false, error: 'Timeout', errorType: 'timeout' }
      case 'network':
        return { success: false, error: 'Network error', errorType: 'network' }
      default:
        return {
          success: false,
          error: message,
          errorType: 'unknown',
          httpStatus: status,
        }
    }
  }
}

async function fetchTeamMemory(
  state: SyncState,
  repoSlug: string,
  etag?: string | null,
): Promise<TeamMemorySyncFetchResult> {
  const bindings = getMemoryHostBindings()
  let lastResult: TeamMemorySyncFetchResult | null = null

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    lastResult = await fetchTeamMemoryOnce(state, repoSlug, etag)
    if (lastResult.success || lastResult.skipRetry) {
      return lastResult
    }
    if (attempt > MAX_RETRIES) {
      return lastResult
    }
    const delayMs = bindings.getRetryDelay?.(attempt) ?? getRetryDelay(attempt)
    bindings.logDebug?.(`team-memory-sync: retry ${attempt}/${MAX_RETRIES}`, {
      level: 'debug',
    })
    await sleep(delayMs)
  }

  return lastResult!
}

// ─── Upload (push) ───────────────────────────────────────────

export function batchDeltaByBytes(
  delta: Record<string, string>,
): Array<Record<string, string>> {
  const keys = Object.keys(delta).sort()
  if (keys.length === 0) return []

  const EMPTY_BODY_BYTES = Buffer.byteLength('{"entries":{}}', 'utf8')
  const entryBytes = (k: string, v: string): number =>
    Buffer.byteLength(jsonStringify(k), 'utf8') +
    Buffer.byteLength(jsonStringify(v), 'utf8') +
    2

  const batches: Array<Record<string, string>> = []
  let current: Record<string, string> = {}
  let currentBytes = EMPTY_BODY_BYTES

  for (const key of keys) {
    const added = entryBytes(key, delta[key]!)
    if (
      currentBytes + added > MAX_PUT_BODY_BYTES &&
      Object.keys(current).length > 0
    ) {
      batches.push(current)
      current = {}
      currentBytes = EMPTY_BODY_BYTES
    }
    current[key] = delta[key]!
    currentBytes += added
  }
  batches.push(current)
  return batches
}

async function uploadTeamMemory(
  state: SyncState,
  repoSlug: string,
  entries: Record<string, string>,
  ifMatchChecksum?: string | null,
): Promise<TeamMemorySyncUploadResult> {
  const bindings = getMemoryHostBindings()
  try {
    await bindings.checkAndRefreshOAuthTokenIfNeeded?.()

    const auth = getAuthHeaders()
    if (auth.error) {
      return { success: false, error: auth.error, errorType: 'auth' }
    }

    const headers: Record<string, string> = {
      ...auth.headers,
      'Content-Type': 'application/json',
    }
    if (ifMatchChecksum) {
      headers['If-Match'] = `"${ifMatchChecksum.replace(/"/g, '')}"`
    }

    const endpoint = getTeamMemorySyncEndpoint(repoSlug)
    const response = await axios.put(
      endpoint,
      { entries },
      {
        headers,
        timeout: TEAM_MEMORY_SYNC_TIMEOUT_MS,
        validateStatus: status => status === 200 || status === 412,
      },
    )

    if (response.status === 412) {
      bindings.logDebug?.('team-memory-sync: conflict (412 Precondition Failed)', {
        level: 'info',
      })
      return { success: false, conflict: true, error: 'ETag mismatch' }
    }

    const responseChecksum = response.data?.checksum
    if (responseChecksum) {
      state.lastKnownChecksum = responseChecksum
    }

    bindings.logDebug?.(
      `team-memory-sync: uploaded ${Object.keys(entries).length} entries (checksum: ${responseChecksum ?? 'none'})`,
      { level: 'debug' },
    )
    return {
      success: true,
      checksum: responseChecksum,
      lastModified: response.data?.lastModified,
    }
  } catch (error) {
    const body = axios.isAxiosError(error)
      ? JSON.stringify(error.response?.data ?? '')
      : ''
    bindings.logDebug?.(
      `team-memory-sync: upload failed: ${error instanceof Error ? error.message : ''} ${body}`,
      { level: 'warn' },
    )
    const { kind, status: httpStatus, message } = classifyAxiosError(error)
    const errorType = kind === 'http' || kind === 'other' ? 'unknown' : kind
    let serverErrorCode: 'team_memory_too_many_entries' | undefined
    let serverMaxEntries: number | undefined
    let serverReceivedEntries: number | undefined
    if (httpStatus === 413 && axios.isAxiosError(error)) {
      const parsed = TeamMemoryTooManyEntriesSchema().safeParse(
        error.response?.data,
      )
      if (parsed.success) {
        serverErrorCode = parsed.data.error.details.error_code
        serverMaxEntries = parsed.data.error.details.max_entries
        serverReceivedEntries = parsed.data.error.details.received_entries
      }
    }
    return {
      success: false,
      error: message,
      errorType,
      httpStatus,
      ...(serverErrorCode !== undefined && { serverErrorCode }),
      ...(serverMaxEntries !== undefined && { serverMaxEntries }),
      ...(serverReceivedEntries !== undefined && { serverReceivedEntries }),
    }
  }
}

// ─── Local file operations ───────────────────────────────────

async function readLocalTeamMemory(maxEntries: number | null): Promise<{
  entries: Record<string, string>
  skippedSecrets: SkippedSecretFile[]
}> {
  const bindings = getMemoryHostBindings()
  const teamDir = getTeamMemPath()
  const entries: Record<string, string> = {}
  const skippedSecrets: SkippedSecretFile[] = []

  async function walkDir(dir: string): Promise<void> {
    try {
      const dirEntries = await readdir(dir, { withFileTypes: true })
      await Promise.all(
        dirEntries.map(async entry => {
          const fullPath = join(dir, entry.name)
          if (entry.isDirectory()) {
            await walkDir(fullPath)
          } else if (entry.isFile()) {
            try {
              const stats = await stat(fullPath)
              if (stats.size > MAX_FILE_SIZE_BYTES) {
                bindings.logDebug?.(
                  `team-memory-sync: skipping oversized file ${entry.name} (${stats.size} > ${MAX_FILE_SIZE_BYTES} bytes)`,
                  { level: 'info' },
                )
                return
              }
              const content = await readFile(fullPath, 'utf8')
              const relPath = relative(teamDir, fullPath).replaceAll('\\', '/')

              const secretMatches = bindings.scanForSecrets?.(content) ?? []
              if (secretMatches.length > 0) {
                const firstMatch = secretMatches[0]!
                skippedSecrets.push({
                  path: relPath,
                  ruleId: firstMatch.ruleId,
                  label: firstMatch.label,
                })
                bindings.logDebug?.(
                  `team-memory-sync: skipping "${relPath}" — detected ${firstMatch.label}`,
                  { level: 'warn' },
                )
                return
              }

              entries[relPath] = content
            } catch {
              // Skip unreadable files
            }
          }
        }),
      )
    } catch (e) {
      if (isErrnoException(e)) {
        if (e.code !== 'ENOENT' && e.code !== 'EACCES' && e.code !== 'EPERM') {
          throw e
        }
      } else {
        throw e
      }
    }
  }

  await walkDir(teamDir)

  const keys = Object.keys(entries).sort()
  if (maxEntries !== null && keys.length > maxEntries) {
    const dropped = keys.slice(maxEntries)
    bindings.logDebug?.(
      `team-memory-sync: ${keys.length} local entries exceeds server cap of ${maxEntries}; ${dropped.length} file(s) will NOT sync: ${dropped.join(', ')}. Consider consolidating or removing some team memory files.`,
      { level: 'warn' },
    )
    bindings.logEvent?.('tengu_team_mem_entries_capped', {
      total_entries: keys.length,
      dropped_count: dropped.length,
      max_entries: maxEntries,
    })
    const truncated: Record<string, string> = {}
    for (const key of keys.slice(0, maxEntries)) {
      truncated[key] = entries[key]!
    }
    return { entries: truncated, skippedSecrets }
  }
  return { entries, skippedSecrets }
}

async function writeRemoteEntriesToLocal(
  entries: Record<string, string>,
): Promise<number> {
  const bindings = getMemoryHostBindings()
  const results = await Promise.all(
    Object.entries(entries).map(async ([relPath, content]) => {
      let validatedPath: string
      try {
        validatedPath = await validateTeamMemKey(relPath)
      } catch (e) {
        if (e instanceof PathTraversalError) {
          bindings.logDebug?.(`team-memory-sync: ${e.message}`, { level: 'warn' })
          return false
        }
        throw e
      }

      const sizeBytes = Buffer.byteLength(content, 'utf8')
      if (sizeBytes > MAX_FILE_SIZE_BYTES) {
        bindings.logDebug?.(
          `team-memory-sync: skipping oversized remote entry "${relPath}"`,
          { level: 'info' },
        )
        return false
      }

      try {
        const existing = await readFile(validatedPath, 'utf8')
        if (existing === content) {
          return false
        }
      } catch (e) {
        if (
          isErrnoException(e) &&
          e.code !== 'ENOENT' &&
          e.code !== 'ENOTDIR'
        ) {
          bindings.logDebug?.(
            `team-memory-sync: unexpected read error for "${relPath}": ${e.code}`,
            { level: 'debug' },
          )
        }
      }

      try {
        const parentDir = validatedPath.substring(
          0,
          validatedPath.lastIndexOf(sep),
        )
        await mkdir(parentDir, { recursive: true })
        await writeFile(validatedPath, content, 'utf8')
        return true
      } catch (e) {
        bindings.logDebug?.(
          `team-memory-sync: failed to write "${relPath}": ${e}`,
          { level: 'warn' },
        )
        return false
      }
    }),
  )

  return count(results, Boolean)
}

// ─── Public API ──────────────────────────────────────────────

export function isTeamMemorySyncAvailable(): boolean {
  return isUsingOAuth()
}

export async function pullTeamMemory(
  state: SyncState,
  options?: { skipEtagCache?: boolean },
): Promise<{
  success: boolean
  filesWritten: number
  entryCount: number
  notModified?: boolean
  error?: string
}> {
  const bindings = getMemoryHostBindings()
  const skipEtagCache = options?.skipEtagCache ?? false
  const startTime = Date.now()

  if (!isUsingOAuth()) {
    logPull(startTime, { success: false, errorType: 'no_oauth' })
    return {
      success: false,
      filesWritten: 0,
      entryCount: 0,
      error: 'OAuth not available',
    }
  }

  const repoSlug = await bindings.getGithubRepo?.()
  if (!repoSlug) {
    logPull(startTime, { success: false, errorType: 'no_repo' })
    return {
      success: false,
      filesWritten: 0,
      entryCount: 0,
      error: 'No git remote found',
    }
  }

  const etag = skipEtagCache ? null : state.lastKnownChecksum
  const result = await fetchTeamMemory(state, repoSlug, etag)
  if (!result.success) {
    logPull(startTime, {
      success: false,
      errorType: result.errorType,
      status: result.httpStatus,
    })
    return {
      success: false,
      filesWritten: 0,
      entryCount: 0,
      error: result.error,
    }
  }
  if (result.notModified) {
    logPull(startTime, { success: true, notModified: true })
    return { success: true, filesWritten: 0, entryCount: 0, notModified: true }
  }
  if (result.isEmpty || !result.data) {
    state.serverChecksums.clear()
    logPull(startTime, { success: true })
    return { success: true, filesWritten: 0, entryCount: 0 }
  }

  const entries = result.data.content.entries
  const responseChecksums = result.data.content.entryChecksums

  state.serverChecksums.clear()
  if (responseChecksums) {
    for (const [key, hash] of Object.entries(responseChecksums)) {
      state.serverChecksums.set(key, hash)
    }
  } else {
    bindings.logDebug?.(
      'team-memory-sync: server response missing entryChecksums (pre-#283027 deploy) — next push will be full, not delta',
      { level: 'debug' },
    )
  }

  const filesWritten = await writeRemoteEntriesToLocal(entries)
  if (filesWritten > 0) {
    bindings.clearMemoryFileCaches?.()
  }
  bindings.logDebug?.(`team-memory-sync: pulled ${filesWritten} files`, {
    level: 'info',
  })

  logPull(startTime, { success: true, filesWritten })

  return {
    success: true,
    filesWritten,
    entryCount: Object.keys(entries).length,
  }
}

export async function pushTeamMemory(
  state: SyncState,
): Promise<TeamMemorySyncPushResult> {
  const bindings = getMemoryHostBindings()
  const startTime = Date.now()
  let conflictRetries = 0

  if (!isUsingOAuth()) {
    logPush(startTime, { success: false, errorType: 'no_oauth' })
    return {
      success: false,
      filesUploaded: 0,
      error: 'OAuth not available',
      errorType: 'no_oauth',
    }
  }

  const repoSlug = await bindings.getGithubRepo?.()
  if (!repoSlug) {
    logPush(startTime, { success: false, errorType: 'no_repo' })
    return {
      success: false,
      filesUploaded: 0,
      error: 'No git remote found',
      errorType: 'no_repo',
    }
  }

  const localRead = await readLocalTeamMemory(state.serverMaxEntries)
  const entries = localRead.entries
  const skippedSecrets = localRead.skippedSecrets
  if (skippedSecrets.length > 0) {
    const summary = skippedSecrets
      .map(s => `"${s.path}" (${s.label})`)
      .join(', ')
    bindings.logDebug?.(
      `team-memory-sync: ${skippedSecrets.length} file(s) skipped due to detected secrets: ${summary}. Remove the secret(s) to enable sync for these files.`,
      { level: 'warn' },
    )
    bindings.logEvent?.('tengu_team_mem_secret_skipped', {
      file_count: skippedSecrets.length,
      rule_ids: skippedSecrets.map(s => s.ruleId).join(','),
    })
  }

  const localHashes = new Map<string, string>()
  for (const [key, content] of Object.entries(entries)) {
    localHashes.set(key, hashContent(content))
  }

  let sawConflict = false

  for (
    let conflictAttempt = 0;
    conflictAttempt <= MAX_CONFLICT_RETRIES;
    conflictAttempt++
  ) {
    const delta: Record<string, string> = {}
    for (const [key, localHash] of localHashes) {
      if (state.serverChecksums.get(key) !== localHash) {
        delta[key] = entries[key]!
      }
    }
    const deltaCount = Object.keys(delta).length

    if (deltaCount === 0) {
      logPush(startTime, {
        success: true,
        conflict: sawConflict,
        conflictRetries,
      })
      return {
        success: true,
        filesUploaded: 0,
        ...(skippedSecrets.length > 0 && { skippedSecrets }),
      }
    }

    const batches = batchDeltaByBytes(delta)
    let filesUploaded = 0
    let result: TeamMemorySyncUploadResult | undefined

    for (const batch of batches) {
      result = await uploadTeamMemory(
        state,
        repoSlug,
        batch,
        state.lastKnownChecksum,
      )
      if (!result.success) break

      for (const key of Object.keys(batch)) {
        state.serverChecksums.set(key, localHashes.get(key)!)
      }
      filesUploaded += Object.keys(batch).length
    }
    result = result!

    if (result.success) {
      bindings.logDebug?.(
        batches.length > 1
          ? `team-memory-sync: pushed ${filesUploaded} of ${localHashes.size} files in ${batches.length} batches`
          : `team-memory-sync: pushed ${filesUploaded} of ${localHashes.size} files (delta)`,
        { level: 'info' },
      )
      logPush(startTime, {
        success: true,
        filesUploaded,
        conflict: sawConflict,
        conflictRetries,
        putBatches: batches.length > 1 ? batches.length : undefined,
      })
      return {
        success: true,
        filesUploaded,
        checksum: result.checksum,
        ...(skippedSecrets.length > 0 && { skippedSecrets }),
      }
    }

    if (!result.conflict) {
      if (result.serverMaxEntries !== undefined) {
        state.serverMaxEntries = result.serverMaxEntries
        bindings.logDebug?.(
          `team-memory-sync: learned server max_entries=${result.serverMaxEntries} from 413; next push will truncate to this`,
          { level: 'warn' },
        )
      }
      logPush(startTime, {
        success: false,
        filesUploaded,
        conflictRetries,
        putBatches: batches.length > 1 ? batches.length : undefined,
        errorType: result.errorType,
        status: result.httpStatus,
        errorCode: result.serverErrorCode,
        serverMaxEntries: result.serverMaxEntries,
        serverReceivedEntries: result.serverReceivedEntries,
      })
      return {
        success: false,
        filesUploaded,
        error: result.error,
        errorType: result.errorType,
        httpStatus: result.httpStatus,
      }
    }

    sawConflict = true
    if (conflictAttempt >= MAX_CONFLICT_RETRIES) {
      bindings.logDebug?.(
        `team-memory-sync: giving up after ${MAX_CONFLICT_RETRIES} conflict retries`,
        { level: 'warn' },
      )
      logPush(startTime, {
        success: false,
        conflict: true,
        conflictRetries,
        errorType: 'conflict',
      })
      return {
        success: false,
        filesUploaded: 0,
        conflict: true,
        error: 'Conflict resolution failed after retries',
      }
    }

    conflictRetries++

    bindings.logDebug?.(
      `team-memory-sync: conflict (412), probing server hashes (attempt ${conflictAttempt + 1}/${MAX_CONFLICT_RETRIES})`,
      { level: 'info' },
    )

    const probe = await fetchTeamMemoryHashes(state, repoSlug)
    if (!probe.success || !probe.entryChecksums) {
      logPush(startTime, {
        success: false,
        conflict: true,
        conflictRetries,
        errorType: 'conflict',
      })
      return {
        success: false,
        filesUploaded: 0,
        conflict: true,
        error: `Conflict resolution hashes probe failed: ${probe.error}`,
      }
    }
    state.serverChecksums.clear()
    for (const [key, hash] of Object.entries(probe.entryChecksums)) {
      state.serverChecksums.set(key, hash)
    }
  }

  logPush(startTime, { success: false, conflictRetries })
  return {
    success: false,
    filesUploaded: 0,
    error: 'Unexpected end of conflict resolution loop',
  }
}

export async function syncTeamMemory(state: SyncState): Promise<{
  success: boolean
  filesPulled: number
  filesPushed: number
  error?: string
}> {
  const pullResult = await pullTeamMemory(state, { skipEtagCache: true })
  if (!pullResult.success) {
    return {
      success: false,
      filesPulled: 0,
      filesPushed: 0,
      error: pullResult.error,
    }
  }

  const pushResult = await pushTeamMemory(state)
  if (!pushResult.success) {
    return {
      success: false,
      filesPulled: pullResult.filesWritten,
      filesPushed: 0,
      error: pushResult.error,
    }
  }

  const bindings = getMemoryHostBindings()
  bindings.logDebug?.(
    `team-memory-sync: synced (pulled ${pullResult.filesWritten}, pushed ${pushResult.filesUploaded})`,
    { level: 'info' },
  )

  return {
    success: true,
    filesPulled: pullResult.filesWritten,
    filesPushed: pushResult.filesUploaded,
  }
}

// ─── Telemetry helpers ───────────────────────────────────────

function logPull(
  startTime: number,
  outcome: {
    success: boolean
    filesWritten?: number
    notModified?: boolean
    errorType?: string
    status?: number
  },
): void {
  const bindings = getMemoryHostBindings()
  bindings.logEvent?.('tengu_team_mem_sync_pull', {
    success: outcome.success,
    files_written: outcome.filesWritten ?? 0,
    not_modified: outcome.notModified ?? false,
    duration_ms: Date.now() - startTime,
    ...(outcome.errorType && { errorType: outcome.errorType }),
    ...(outcome.status && { status: outcome.status }),
  })
}

function logPush(
  startTime: number,
  outcome: {
    success: boolean
    filesUploaded?: number
    conflict?: boolean
    conflictRetries?: number
    errorType?: string
    status?: number
    putBatches?: number
    errorCode?: string
    serverMaxEntries?: number
    serverReceivedEntries?: number
  },
): void {
  const bindings = getMemoryHostBindings()
  bindings.logEvent?.('tengu_team_mem_sync_push', {
    success: outcome.success,
    files_uploaded: outcome.filesUploaded ?? 0,
    conflict: outcome.conflict ?? false,
    conflict_retries: outcome.conflictRetries ?? 0,
    duration_ms: Date.now() - startTime,
    ...(outcome.errorType && { errorType: outcome.errorType }),
    ...(outcome.status && { status: outcome.status }),
    ...(outcome.putBatches && { put_batches: outcome.putBatches }),
    ...(outcome.errorCode && { error_code: outcome.errorCode }),
    ...(outcome.serverMaxEntries !== undefined && {
      server_max_entries: outcome.serverMaxEntries,
    }),
    ...(outcome.serverReceivedEntries !== undefined && {
      server_received_entries: outcome.serverReceivedEntries,
    }),
  })
}
