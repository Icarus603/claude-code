import axios from 'axios'
import { constants as fsConstants } from 'fs'
import { access, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import {
  getDynamicConfig_BLOCKS_ON_INIT,
  getDynamicConfig_CACHED_MAY_BE_STALE,
} from '@claude-code/config/feature-flags'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '@claude-code/local-observability'
import { type ReleaseChannel, saveGlobalConfig } from '@claude-code/config'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { env } from '@claude-code/config/env/paths'
import { getClaudeConfigHomeDir } from '@claude-code/config/env/utils'
import { ClaudeError, getErrnoCode, isENOENT } from '@claude-code/local-observability/errorHelpers.js'
import { execFileNoThrowWithCwd } from '@claude-code/shell/execFileNoThrow.js'
import { getFsImplementation } from '@claude-code/storage/fsOperations.js'
import { gracefulShutdownSync } from '@claude-code/app-host/bootstrap/gracefulShutdown.js'
import { logError } from '@claude-code/local-observability/logging'
import { gt, gte, lt, parseVersion } from '@claude-code/config/semver'
import { getInitialSettings } from '@claude-code/config/settings'
import {
  filterClaudeAliases,
  getShellConfigPaths,
  readFileLines,
  writeFileLines,
} from '@claude-code/shell/shellConfig.js'
import { jsonParse } from '@claude-code/local-observability/slowOperations.js'

const GCS_BUCKET_URL =
  'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases'

class AutoUpdaterError extends ClaudeError {}

export type InstallStatus =
  | 'success'
  | 'no_permissions'
  | 'install_failed'
  | 'in_progress'

export type AutoUpdaterResult = {
  version: string | null
  status: InstallStatus
  notifications?: string[]
}

export type MaxVersionConfig = {
  external?: string
  ant?: string
  external_message?: string
  ant_message?: string
  /**
   * Port of ant v2.1.136 — when paired with `external`/`ant` maxVersion,
   * enables a forced downgrade path: the auto-updater will move the user
   * from a newer version back to `maxVersion`. Default behaviour (flag
   * absent or false) is no-downgrade; force-downgrade only activates when
   * this is explicitly true. Acts as a remote kill-switch — must be wired
   * to telemetry (`tengu_auto_updater_forced_downgrade`) so operators can
   * see when it fires.
   */
  external_force_downgrade?: boolean
  ant_force_downgrade?: boolean
}

/**
 * Returns whether force-downgrade is enabled for the active user type.
 * Defaults to false. Companion to `getMaxVersion()` — both must be true
 * for a downgrade to fire.
 */
export async function isForceDowngradeEnabled(): Promise<boolean> {
  const config = await getMaxVersionConfig()
  if (process.env.USER_TYPE === 'ant') {
    return config.ant_force_downgrade === true
  }
  return config.external_force_downgrade === true
}

/**
 * Combined config snapshot — mirror of ant `Lw_()` (3480.js). One async
 * call returns both `{maxVersion, forceDowngradeEnabled}` so consumers
 * don't make two trips to the feature-flag service.
 *
 * Returns `{maxVersion: undefined, forceDowngradeEnabled: false}` when
 * the config is missing or the version is invalid (matches ant —
 * invalid versions are logged via `tengu_max_version_config_invalid`
 * and treated as absent).
 */
export async function getMaxVersionAndForceDowngrade(): Promise<{
  maxVersion: string | undefined
  forceDowngradeEnabled: boolean
}> {
  const config = await getMaxVersionConfig()
  const maxVersion = await getMaxVersion()
  const forceDowngradeEnabled =
    process.env.USER_TYPE === 'ant'
      ? config.ant_force_downgrade === true
      : config.external_force_downgrade === true
  return { maxVersion, forceDowngradeEnabled }
}

/**
 * Port of ant `UK6` (3480.js). Decides whether a force-downgrade should
 * actually fire by comparing the current version to the target. Returns
 * true ONLY when `currentVersion > targetVersion` (semver compare); a
 * "flag set but current already ≤ target" condition logs and returns
 * false (no downgrade needed, take the normal upgrade path).
 *
 * `reason` is the caller context for the log line — values mirror ant:
 *   - `'native_update'`  → "Native installer: ..."
 *   - everything else    → "AutoUpdater: ..."
 *
 * The version parse is delegated to `gt()` (semver) which returns false
 * when either side is unparseable. ant additionally `parse(currentVersion)`
 * up front and short-circuits on null parse; ccb's `gt()` does the same
 * via its underlying `semver.parse`.
 */
export function shouldForceDowngradeNow(
  currentVersion: string,
  targetVersion: string,
  reason: 'native_update' | 'auto_updater',
): boolean {
  const tag = reason === 'native_update' ? 'Native installer' : 'AutoUpdater'
  let isAbove = false
  try {
    // Bun.semver.order throws on unparseable input; ant's
    // `uX8.parse(H)?.compare(_)` returns null. Match the null
    // contract via try/catch — unparseable on either side ⇒ false.
    isAbove = gt(currentVersion, targetVersion)
  } catch {
    isAbove = false
  }
  if (isAbove) {
    logForDebugging(
      `${tag}: force-downgrade active — moving from ${currentVersion} to ${targetVersion}`,
    )
    return true
  }
  logForDebugging(
    `${tag}: force-downgrade flag set but current ${currentVersion} is not above ${targetVersion} — taking normal upgrade path`,
  )
  return false
}

/**
 * Checks if the current version meets the minimum required version from Statsig config
 * Terminates the process with an error message if the version is too old
 *
 * NOTE ON SHA-BASED VERSIONING:
 * We use SemVer-compliant versioning with build metadata format (X.X.X+SHA) for continuous deployment.
 * According to SemVer specs, build metadata (the +SHA part) is ignored when comparing versions.
 *
 * Versioning approach:
 * 1. For version requirements/compatibility (assertMinVersion), we use semver comparison that ignores build metadata
 * 2. For updates ('claude update'), we use exact string comparison to detect any change, including SHA
 *    - This ensures users always get the latest build, even when only the SHA changes
 *    - The UI clearly shows both versions including build metadata
 *
 * This approach keeps version comparison logic simple while maintaining traceability via the SHA.
 */
export async function assertMinVersion(): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    return
  }

  try {
    const versionConfig = await getDynamicConfig_BLOCKS_ON_INIT<{
      minVersion: string
    }>('tengu_version_config', { minVersion: '0.0.0' })

    if (
      versionConfig.minVersion &&
      lt(MACRO.VERSION, versionConfig.minVersion)
    ) {
      console.error(`
It looks like your version of Claude Code (${MACRO.VERSION}) needs an update.
A newer version (${versionConfig.minVersion} or higher) is required to continue.

To update, please run:
    claude update

This will ensure you have access to the latest features and improvements.
`)
      gracefulShutdownSync(1)
    }
  } catch (error) {
    logError(error as Error)
  }
}

/**
 * Returns the maximum allowed version for the current user type.
 * For ants, returns the `ant` field (dev version format).
 * For external users, returns the `external` field (clean semver).
 * This is used as a server-side kill switch to pause auto-updates during incidents.
 * Returns undefined if no cap is configured.
 */
export async function getMaxVersion(): Promise<string | undefined> {
  const config = await getMaxVersionConfig()
  const raw =
    process.env.USER_TYPE === 'ant'
      ? config.ant || undefined
      : config.external || undefined
  if (!raw) return undefined
  // Ant `Lw_`: `uX8.parse(q)?.version ?? void 0`. The server-provided
  // value may be malformed (typo, build-metadata-only string, etc.); if
  // it doesn't parse, log telemetry and return undefined so consumers
  // don't compare against garbage.
  const parsed = parseVersion(raw)
  if (!parsed) {
    logForDebugging(
      `tengu_max_version_config has invalid version '${raw}' — ignoring`,
      { level: 'error' },
    )
    logEvent('tengu_max_version_config_invalid', {
      raw_value:
        raw as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return undefined
  }
  return parsed
}

/**
 * Returns the server-driven message explaining the known issue, if configured.
 * Shown in the warning banner when the current version exceeds the max allowed version.
 */
export async function getMaxVersionMessage(): Promise<string | undefined> {
  const config = await getMaxVersionConfig()
  if (process.env.USER_TYPE === 'ant') {
    return config.ant_message || undefined
  }
  return config.external_message || undefined
}

async function getMaxVersionConfig(): Promise<MaxVersionConfig> {
  try {
    return await getDynamicConfig_BLOCKS_ON_INIT<MaxVersionConfig>(
      'tengu_max_version_config',
      {},
    )
  } catch (error) {
    logError(error as Error)
    return {}
  }
}

/**
 * Ant `BV5` (3486.js) — byte-for-byte port. SYNC and reads the
 * CACHED-MAY-BE-STALE GrowthBook config (NOT blocking). The native
 * installer fast-paths past the canary check when GrowthBook hasn't
 * loaded yet — ant explicitly designed this so a slow GB init doesn't
 * stall `claude install`.
 *
 * Prior ccb impl called the BLOCKING variant which would await GB init
 * on every call site, blocking the native installer until GrowthBook
 * resolved (could stall multi-second on cold network).
 *
 * Ant source:
 *   function BV5(){
 *     try{
 *       let H = M_("tengu_canary",{});
 *       return typeof H.external==="string" && _27.valid(H.external) || null
 *     }catch(H){
 *       y(`getCanaryVersion: GB read failed, falling through: ${VH(H)}`);
 *       return null
 *     }
 *   }
 *
 * `_27.valid()` is npm-semver's `valid()`: returns the cleaned
 * canonical version string (e.g. "1.2.3") or `null`. ccb's
 * `parseVersion()` is the same shape (returns `string | undefined`);
 * we coalesce to null to match ant's contract exactly.
 */
export function getCanaryVersion(): string | null {
  try {
    const config = getDynamicConfig_CACHED_MAY_BE_STALE<{ external?: string }>(
      'tengu_canary',
      {},
    )
    const raw = config.external
    if (typeof raw !== 'string') return null
    return parseVersion(raw) ?? null
  } catch (error) {
    logForDebugging(
      `getCanaryVersion: GB read failed, falling through: ${(error as Error).message}`,
    )
    return null
  }
}

/**
 * Skip a target version that's below the user's `minimumVersion` setting.
 * Ant `O7H` (3480.js) uses npm-semver's `lR` with `{loose:true}` which
 * returns `false` for unparseable input. Bun.semver.order (under
 * ccb's `gte`) throws on unparseable — wrap in try/catch and fall
 * back to `true` (skip) to keep the updater non-fatal on bad
 * minimumVersion settings (e.g. ccb's legacy `1.carus.000` calver).
 */
export function shouldSkipVersion(targetVersion: string): boolean {
  const settings = getInitialSettings()
  const minimumVersion = settings?.minimumVersion
  if (!minimumVersion) return false
  let shouldSkip: boolean
  try {
    shouldSkip = !gte(targetVersion, minimumVersion)
  } catch {
    shouldSkip = true
  }
  if (shouldSkip) {
    logForDebugging(
      `Skipping update to ${targetVersion} - below minimumVersion ${minimumVersion}`,
    )
  }
  return shouldSkip
}

// Lock file for auto-updater to prevent concurrent updates
const LOCK_TIMEOUT_MS = 5 * 60 * 1000 // 5 minute timeout for locks

/**
 * Get the path to the lock file
 * This is a function to ensure it's evaluated at runtime after test setup
 */
export function getLockFilePath(): string {
  return join(getClaudeConfigHomeDir(), '.update.lock')
}

/**
 * Attempts to acquire a lock for auto-updater
 * @returns true if lock was acquired, false if another process holds the lock
 */
async function acquireLock(): Promise<boolean> {
  const fs = getFsImplementation()
  const lockPath = getLockFilePath()

  // Check for existing lock: 1 stat() on the happy path (fresh lock or ENOENT),
  // 2 on stale-lock recovery (re-verify staleness immediately before unlink).
  try {
    const stats = await fs.stat(lockPath)
    const age = Date.now() - stats.mtimeMs
    if (age < LOCK_TIMEOUT_MS) {
      return false
    }
    // Lock is stale, remove it before taking over. Re-verify staleness
    // immediately before unlinking to close a TOCTOU race: if two processes
    // both observe the stale lock, A unlinks + writes a fresh lock, then B
    // would unlink A's fresh lock and both believe they hold it. A fresh
    // lock has a recent mtime, so re-checking staleness makes B back off.
    try {
      const recheck = await fs.stat(lockPath)
      if (Date.now() - recheck.mtimeMs < LOCK_TIMEOUT_MS) {
        return false
      }
      await fs.unlink(lockPath)
    } catch (err) {
      if (!isENOENT(err)) {
        logError(err as Error)
        return false
      }
    }
  } catch (err) {
    if (!isENOENT(err)) {
      logError(err as Error)
      return false
    }
    // ENOENT: no lock file, proceed to create one
  }

  // Create lock file atomically with O_EXCL (flag: 'wx'). If another process
  // wins the race and creates it first, we get EEXIST and back off.
  // Lazy-mkdir the config dir on ENOENT.
  try {
    await writeFile(lockPath, `${process.pid}`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    return true
  } catch (err) {
    const code = getErrnoCode(err)
    if (code === 'EEXIST') {
      return false
    }
    if (code === 'ENOENT') {
      try {
        // fs.mkdir from getFsImplementation() is always recursive:true and
        // swallows EEXIST internally, so a dir-creation race cannot reach the
        // catch below — only writeFile's EEXIST (true lock contention) can.
        await fs.mkdir(getClaudeConfigHomeDir())
        await writeFile(lockPath, `${process.pid}`, {
          encoding: 'utf8',
          flag: 'wx',
        })
        return true
      } catch (mkdirErr) {
        if (getErrnoCode(mkdirErr) === 'EEXIST') {
          return false
        }
        logError(mkdirErr as Error)
        return false
      }
    }
    logError(err as Error)
    return false
  }
}

/**
 * Releases the update lock if it's held by this process
 */
async function releaseLock(): Promise<void> {
  const fs = getFsImplementation()
  const lockPath = getLockFilePath()
  try {
    const lockData = await fs.readFile(lockPath, { encoding: 'utf8' })
    if (lockData === `${process.pid}`) {
      await fs.unlink(lockPath)
    }
  } catch (err) {
    if (isENOENT(err)) {
      return
    }
    logError(err as Error)
  }
}

async function getInstallationPrefix(): Promise<string | null> {
  // Run from home directory to avoid reading project-level .npmrc/.bunfig.toml
  const isBun = env.isRunningWithBun()
  let prefixResult = null
  if (isBun) {
    prefixResult = await execFileNoThrowWithCwd('bun', ['pm', 'bin', '-g'], {
      cwd: homedir(),
    })
  } else {
    prefixResult = await execFileNoThrowWithCwd(
      'npm',
      ['-g', 'config', 'get', 'prefix'],
      { cwd: homedir() },
    )
  }
  if (prefixResult.code !== 0) {
    logError(new Error(`Failed to check ${isBun ? 'bun' : 'npm'} permissions`))
    return null
  }
  return prefixResult.stdout.trim()
}

export async function checkGlobalInstallPermissions(): Promise<{
  hasPermissions: boolean
  npmPrefix: string | null
}> {
  try {
    const prefix = await getInstallationPrefix()
    if (!prefix) {
      return { hasPermissions: false, npmPrefix: null }
    }

    try {
      await access(prefix, fsConstants.W_OK)
      return { hasPermissions: true, npmPrefix: prefix }
    } catch {
      logError(
        new AutoUpdaterError(
          'Insufficient permissions for global npm install.',
        ),
      )
      return { hasPermissions: false, npmPrefix: prefix }
    }
  } catch (error) {
    logError(error as Error)
    return { hasPermissions: false, npmPrefix: null }
  }
}

export async function getLatestVersion(
  channel: ReleaseChannel,
): Promise<string | null> {
  // ccb default: GitHub Releases. The npm path below is kept for
  // ant-internal users only; MACRO.PACKAGE_URL is empty in this build
  // so the npm call would fail anyway.
  if (process.env.USER_TYPE !== 'ant') {
    try {
      const { fetchLatestReleaseTag } = await import(
        './githubReleases.js'
      )
      const tag = await fetchLatestReleaseTag()
      // Strip leading "v" — MACRO.VERSION is "1.carus.000", not "v1.carus.000".
      return tag.startsWith('v') ? tag.slice(1) : tag
    } catch (error) {
      logForDebugging(`getLatestVersion: GitHub fetch failed: ${error}`)
      return null
    }
  }

  const npmTag = channel === 'stable' ? 'stable' : 'latest'

  // Run from home directory to avoid reading project-level .npmrc
  // which could be maliciously crafted to redirect to an attacker's registry
  const result = await execFileNoThrowWithCwd(
    'npm',
    ['view', `${MACRO.PACKAGE_URL}@${npmTag}`, 'version', '--prefer-online'],
    { abortSignal: AbortSignal.timeout(5000), cwd: homedir() },
  )
  if (result.code !== 0) {
    logForDebugging(`npm view failed with code ${result.code}`)
    if (result.stderr) {
      logForDebugging(`npm stderr: ${result.stderr.trim()}`)
    } else {
      logForDebugging('npm stderr: (empty)')
    }
    if (result.stdout) {
      logForDebugging(`npm stdout: ${result.stdout.trim()}`)
    }
    return null
  }
  return result.stdout.trim()
}

export type NpmDistTags = {
  latest: string | null
  stable: string | null
}

/**
 * Get npm dist-tags (latest and stable versions) from the registry.
 * This is used by the doctor command to show users what versions are available.
 */
export async function getNpmDistTags(): Promise<NpmDistTags> {
  // Run from home directory to avoid reading project-level .npmrc
  const result = await execFileNoThrowWithCwd(
    'npm',
    ['view', MACRO.PACKAGE_URL, 'dist-tags', '--json', '--prefer-online'],
    { abortSignal: AbortSignal.timeout(5000), cwd: homedir() },
  )

  if (result.code !== 0) {
    logForDebugging(`npm view dist-tags failed with code ${result.code}`)
    return { latest: null, stable: null }
  }

  try {
    const parsed = jsonParse(result.stdout.trim()) as Record<string, unknown>
    return {
      latest: typeof parsed.latest === 'string' ? parsed.latest : null,
      stable: typeof parsed.stable === 'string' ? parsed.stable : null,
    }
  } catch (error) {
    logForDebugging(`Failed to parse dist-tags: ${error}`)
    return { latest: null, stable: null }
  }
}

/**
 * Get the latest version from GCS bucket for a given release channel.
 * This is used by installations that don't have npm (e.g. package manager installs).
 */
export async function getLatestVersionFromGcs(
  channel: ReleaseChannel,
): Promise<string | null> {
  try {
    const response = await axios.get(`${GCS_BUCKET_URL}/${channel}`, {
      timeout: 5000,
      responseType: 'text',
    })
    return response.data.trim()
  } catch (error) {
    logForDebugging(`Failed to fetch ${channel} from GCS: ${error}`)
    return null
  }
}

/**
 * Port of ant v2.1.136 `XV5` (3480.js). Read the cask's published
 * version from formulae.brew.sh. The Homebrew formula publishes new
 * versions on its own cadence (manual cask updates by the maintainer),
 * so the version it returns can lag the GCS pointer by hours. We fall
 * back to GCS when the brew API fails or returns nothing — see
 * `getLatestVersionForBrew` below.
 */
export async function getLatestVersionFromHomebrew(
  formulaName: string,
): Promise<string | null> {
  try {
    const response = await axios.get(
      `https://formulae.brew.sh/api/cask/${formulaName}.json`,
      { timeout: 5000, responseType: 'json' },
    )
    const version = (response.data as { version?: unknown })?.version
    return typeof version === 'string' ? version : null
  } catch (error) {
    logForDebugging(
      `Failed to fetch ${formulaName} from formulae.brew.sh: ${error}`,
    )
    return null
  }
}

/**
 * Port of ant v2.1.136 `FK6` (3480.js). For Homebrew cask installs the
 * canonical source of truth is `formulae.brew.sh/api/cask/<name>.json`
 * (so the auto-updater agrees with what `brew upgrade --cask` would
 * actually fetch). Falls back to the GCS channel pointer when the
 * brew API fails, so users on dev-channel formulae aren't stuck.
 */
export async function getLatestVersionForBrew(
  formulaName: string,
  channel: ReleaseChannel,
): Promise<string | null> {
  const [brew, gcs] = await Promise.all([
    getLatestVersionFromHomebrew(formulaName),
    getLatestVersionFromGcs(channel),
  ])
  return brew ?? gcs
}

/**
 * Get available versions from GCS bucket (for native installations).
 * Fetches both latest and stable channel pointers.
 */
export async function getGcsDistTags(): Promise<NpmDistTags> {
  const [latest, stable] = await Promise.all([
    getLatestVersionFromGcs('latest'),
    getLatestVersionFromGcs('stable'),
  ])

  return { latest, stable }
}

// Dist-tags for ccb native installs (doctor "Updates" panel). Thin
// facade over githubReleases — re-exposed here so the doctor screen gets
// all three dist-tag sources (GCS / npm / GitHub) from one entrypoint
// without growing the package export-surface budget. Dynamic import
// mirrors getLatestVersion above and keeps the autoUpdater→githubReleases
// edge off the static cycle graph. See githubReleases.getGithubDistTags
// for why native ccb must resolve "latest" from GitHub, not GCS.
export async function getGithubDistTags(): Promise<NpmDistTags> {
  const { getGithubDistTags: impl } = await import('./githubReleases.js')
  return impl()
}

/**
 * Get version history from npm registry (ant-only feature)
 * Returns versions sorted newest-first, limited to the specified count
 *
 * Uses NATIVE_PACKAGE_URL when available because:
 * 1. Native installation is the primary installation method for ant users
 * 2. Not all JS package versions have corresponding native packages
 * 3. This prevents rollback from listing versions that don't have native binaries
 */
export async function getVersionHistory(limit: number): Promise<string[]> {
  if (process.env.USER_TYPE !== 'ant') {
    return []
  }

  // Use native package URL when available to ensure we only show versions
  // that have native binaries (not all JS package versions have native builds)
  const packageUrl = MACRO.NATIVE_PACKAGE_URL ?? MACRO.PACKAGE_URL

  // Run from home directory to avoid reading project-level .npmrc
  const result = await execFileNoThrowWithCwd(
    'npm',
    ['view', packageUrl, 'versions', '--json', '--prefer-online'],
    // Longer timeout for version list
    { abortSignal: AbortSignal.timeout(30000), cwd: homedir() },
  )

  if (result.code !== 0) {
    logForDebugging(`npm view versions failed with code ${result.code}`)
    if (result.stderr) {
      logForDebugging(`npm stderr: ${result.stderr.trim()}`)
    }
    return []
  }

  try {
    const versions = jsonParse(result.stdout.trim()) as string[]
    // Take last N versions, then reverse to get newest first
    return versions.slice(-limit).reverse()
  } catch (error) {
    logForDebugging(`Failed to parse version history: ${error}`)
    return []
  }
}

export async function installGlobalPackage(
  specificVersion?: string | null,
): Promise<InstallStatus> {
  if (!(await acquireLock())) {
    logError(
      new AutoUpdaterError('Another process is currently installing an update'),
    )
    // Log the lock contention
    logEvent('tengu_auto_updater_lock_contention', {
      pid: process.pid,
      currentVersion:
        MACRO.VERSION as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return 'in_progress'
  }

  try {
    await removeClaudeAliasesFromShellConfigs()
    // Check if we're using npm from Windows path in WSL
    if (!env.isRunningWithBun() && env.isNpmFromWindowsPath()) {
      logError(new Error('Windows NPM detected in WSL environment'))
      logEvent('tengu_auto_updater_windows_npm_in_wsl', {
        currentVersion:
          MACRO.VERSION as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      console.error(`
Error: Windows NPM detected in WSL

You're running Claude Code in WSL but using the Windows NPM installation from /mnt/c/.
This configuration is not supported for updates.

To fix this issue:
  1. Install Node.js within your Linux distribution: e.g. sudo apt install nodejs npm
  2. Make sure Linux NPM is in your PATH before the Windows version
  3. Try updating again with 'claude update'
`)
      return 'install_failed'
    }

    const { hasPermissions } = await checkGlobalInstallPermissions()
    if (!hasPermissions) {
      return 'no_permissions'
    }

    // Use specific version if provided, otherwise use latest
    const packageSpec = specificVersion
      ? `${MACRO.PACKAGE_URL}@${specificVersion}`
      : MACRO.PACKAGE_URL

    // Run from home directory to avoid reading project-level .npmrc/.bunfig.toml
    // which could be maliciously crafted to redirect to an attacker's registry
    const packageManager = env.isRunningWithBun() ? 'bun' : 'npm'
    const installResult = await execFileNoThrowWithCwd(
      packageManager,
      ['install', '-g', packageSpec],
      { cwd: homedir() },
    )
    if (installResult.code !== 0) {
      const error = new AutoUpdaterError(
        `Failed to install new version of claude: ${installResult.stdout} ${installResult.stderr}`,
      )
      logError(error)
      return 'install_failed'
    }

    // Set installMethod to 'global' to track npm global installations
    saveGlobalConfig(current => ({
      ...current,
      installMethod: 'global',
    }))

    return 'success'
  } finally {
    // Ensure we always release the lock
    await releaseLock()
  }
}

/**
 * Remove claude aliases from shell configuration files
 * This helps clean up old installation methods when switching to native or npm global
 */
async function removeClaudeAliasesFromShellConfigs(): Promise<void> {
  const configMap = getShellConfigPaths()

  // Process each shell config file
  for (const [, configFile] of Object.entries(configMap)) {
    try {
      const lines = await readFileLines(configFile)
      if (!lines) continue

      const { filtered, hadAlias } = filterClaudeAliases(lines)

      if (hadAlias) {
        await writeFileLines(configFile, filtered)
        logForDebugging(`Removed claude alias from ${configFile}`)
      }
    } catch (error) {
      // Don't fail the whole operation if one file can't be processed
      logForDebugging(`Failed to remove alias from ${configFile}: ${error}`, {
        level: 'error',
      })
    }
  }
}
