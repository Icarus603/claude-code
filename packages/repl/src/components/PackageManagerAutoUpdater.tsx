import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { promisify } from 'node:util'
import * as React from 'react'
import { useRef, useState } from 'react'
import { useInterval } from 'usehooks-ts'
import { Text } from '@anthropic/ink'
import {
  type AutoUpdaterResult,
  getLatestVersionForBrew,
  getLatestVersionFromGcs,
  getMaxVersion,
  shouldSkipVersion,
} from '@claude-code/updater/autoUpdater.js'
import { isAutoUpdaterDisabled } from '@claude-code/config'
import { logEvent } from '@claude-code/local-observability'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import {
  detectBrewFormulaName,
  getPackageManager,
  type PackageManager,
} from '@claude-code/updater/nativeInstaller/packageManagers.js'
import { gt, gte } from '@claude-code/config/semver'
import { isEnvTruthy } from '@claude-code/config/env/utils'
import { getInitialSettings } from '@claude-code/config/settings'

const execFileAsync = promisify(execFile)

/**
 * Build the actual argv for a given package manager.
 * Mirrors ant v2.1.136 `ZI3` (4910.js) byte-for-byte.
 *
 *   homebrew → ["brew", "upgrade", "--cask", formulaName ?? "claude-code"]
 *   winget   → ["%LOCALAPPDATA%/Microsoft/WindowsApps/winget.exe",
 *               "upgrade", "--id", "Anthropic.ClaudeCode",
 *               "--exact", "--silent", "--disable-interactivity"]
 *
 * `formulaName` is the actual installed Homebrew cask name (e.g.
 * `claude-code` or `claude-code@latest`) — `brew upgrade --cask
 * claude-code` will NOT touch `claude-code@latest` installs, so we
 * must thread the detected name through.
 */
function buildUpgradeArgv(
  pm: PackageManager,
  formulaName?: string | null,
): string[] | null {
  switch (pm) {
    case 'homebrew':
      return ['brew', 'upgrade', '--cask', formulaName ?? 'claude-code']
    case 'winget': {
      const localAppData = process.env.LOCALAPPDATA
      const wingetPath = localAppData
        ? pathJoin(localAppData, 'Microsoft', 'WindowsApps', 'winget.exe')
        : 'winget'
      return [
        wingetPath,
        'upgrade',
        '--id',
        'Anthropic.ClaudeCode',
        '--exact',
        '--silent',
        '--disable-interactivity',
      ]
    }
    default:
      return null
  }
}

/**
 * Build the user-displayed update command for the warning banner.
 * Mirrors ant v2.1.136 `LI3` (4910.js) byte-for-byte:
 *
 *   homebrew → `brew upgrade ${formulaName ?? "claude-code"}`
 *   winget   → `winget upgrade Anthropic.ClaudeCode`
 *   mise     → `mise upgrade claude`
 *   apk      → `apk upgrade claude-code`
 *   default  → "your package manager update command"
 *
 * pacman, deb, and rpm don't get specific commands because they each
 * have multiple frontends (pacman: yay/paru/makepkg, deb: apt/apt-get/
 * aptitude/nala, rpm: dnf/yum/zypper) — falls through to the default.
 */
function buildUpdateCommand(
  pm: PackageManager,
  formulaName: string | null,
): string {
  switch (pm) {
    case 'homebrew':
      return `brew upgrade ${formulaName ?? 'claude-code'}`
    case 'winget':
      return 'winget upgrade Anthropic.ClaudeCode'
    case 'mise':
      return 'mise upgrade claude'
    case 'apk':
      return 'apk upgrade claude-code'
    default:
      return 'your package manager update command'
  }
}

/** Ant `YyK = 0`, `wyK = 1800000` — 30-min backoff after install_failed. */
const PKG_UPDATE_TIMEOUT_MS = 300_000
const PKG_UPDATE_BACKOFF_MS = 1_800_000

type Props = {
  isUpdating: boolean
  onChangeIsUpdating: (isUpdating: boolean) => void
  onAutoUpdaterResult: (autoUpdaterResult: AutoUpdaterResult | null) => void
  autoUpdaterResult: AutoUpdaterResult | null
  showSuccessMessage: boolean
  verbose: boolean
}

export function PackageManagerAutoUpdater({
  isUpdating,
  onChangeIsUpdating,
  onAutoUpdaterResult,
  autoUpdaterResult,
  showSuccessMessage,
  verbose,
}: Props): React.ReactNode {
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null)
  const [packageManager, setPackageManager] =
    useState<PackageManager>('unknown')
  const [brewFormulaName, setBrewFormulaName] = useState<string | null>(null)
  const lastFailureAtRef = useRef<number>(0)
  const isUpdatingRef = useRef(isUpdating)
  isUpdatingRef.current = isUpdating
  const autoUpdaterResultRef = useRef(autoUpdaterResult)
  autoUpdaterResultRef.current = autoUpdaterResult

  // One-shot package-manager detection on mount. Ant `MyK` does this
  // inside a `useEffect(()=>{...}, [])` and stores the result + the
  // brew formula name (when homebrew) in state. Detection is
  // synchronous-friendly: `getPackageManager` reads `process.execPath`
  // and a few env vars.
  React.useEffect(() => {
    void getPackageManager().then(pm => {
      setPackageManager(pm)
      if (pm === 'homebrew') {
        setBrewFormulaName(detectBrewFormulaName())
      }
    })
  }, [])

  const checkForUpdates = React.useCallback(async () => {
    if (
      process.env.NODE_ENV === 'test' ||
      process.env.NODE_ENV === 'development'
    ) {
      return
    }

    if (isAutoUpdaterDisabled()) {
      return
    }

    if (isUpdatingRef.current) return
    if (autoUpdaterResultRef.current?.status === 'success') return
    // Ant `MyK` install_failed back-off: when we previously failed,
    // wait `PKG_UPDATE_BACKOFF_MS` before retrying. Ant clears the
    // autoUpdaterResult (to null) via the `kI3` reducer when the
    // back-off window has elapsed — mirroring that lets the banner
    // hide the stale failure state.
    if (autoUpdaterResultRef.current?.status === 'install_failed') {
      if (Date.now() - lastFailureAtRef.current < PKG_UPDATE_BACKOFF_MS) {
        return
      }
      onAutoUpdaterResult(null)
    }

    const currentVersion = MACRO.VERSION
    const pm = await getPackageManager()
    let formulaName: string | null = null
    let channel: 'latest' | 'stable' =
      getInitialSettings()?.autoUpdatesChannel === 'stable'
        ? 'stable'
        : 'latest'
    if (pm === 'homebrew') {
      // Ant `MyK` channel-selection branch:
      // `g = Q === 'claude-code@latest' ? 'latest' : 'stable'`. When
      // the user installed the bleeding-edge formula, track 'latest';
      // otherwise track stable.
      formulaName = detectBrewFormulaName()
      channel = formulaName === 'claude-code@latest' ? 'latest' : 'stable'
    }

    // Per-pm latest fetch:
    //   - homebrew: formulae.brew.sh API first (so we agree with what
    //     `brew upgrade --cask` would actually fetch), fall back to GCS.
    //   - others:   GCS channel pointer.
    let latest =
      pm === 'homebrew'
        ? await getLatestVersionForBrew(formulaName ?? 'claude-code', channel)
        : await getLatestVersionFromGcs(channel)
    const maxVersion = await getMaxVersion()

    // Ant `MyK` cap path:
    //   if (maxVersion && latest && uX(latest, maxVersion))
    //     if (lR(currentVersion, maxVersion))  // current at-or-above max
    //       skip (set update available = null)
    //     else
    //       latest = maxVersion; isCapped = true
    let isCapped = false
    if (maxVersion && latest && gt(latest, maxVersion)) {
      logForDebugging(
        `PackageManagerAutoUpdater: maxVersion ${maxVersion} is set, capping update from ${latest} to ${maxVersion}`,
      )
      if (gte(currentVersion, maxVersion)) {
        logForDebugging(
          `PackageManagerAutoUpdater: current version ${currentVersion} is already at or above maxVersion ${maxVersion}, skipping update`,
        )
        setUpdateAvailable(null)
        return
      }
      latest = maxVersion
      isCapped = true
    }

    const hasUpdate =
      latest && !gte(currentVersion, latest) && !shouldSkipVersion(latest)
    setUpdateAvailable(hasUpdate && latest ? latest : null)
    if (!hasUpdate || !latest) return

    logForDebugging(
      `PackageManagerAutoUpdater: Update available ${currentVersion} -> ${latest}`,
    )

    // Ant `MyK`: actually run the upgrade only when:
    //   - `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE` env is truthy
    //   - `buildUpgradeArgv(pm)` returns a non-null argv (i.e. pm is
    //     homebrew or winget — the others get a banner-only hint)
    //   - we didn't cap (`s = true` in ant): when capped, the user is
    //     already at/above maxVersion's "upgrade" semantics — running
    //     `brew upgrade` would re-fetch a possibly older cask without
    //     advancing the user. Ant gates on `!s`.
    if (!isEnvTruthy(process.env.CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE)) {
      return
    }
    const argv = buildUpgradeArgv(pm, formulaName)
    if (!argv || isCapped) return
    if (isUpdatingRef.current) return

    onChangeIsUpdating(true)
    const start = Date.now()
    const baseEvent = {
      pm_homebrew: pm === 'homebrew',
      pm_winget: pm === 'winget',
    }
    logEvent('tengu_pkg_manager_auto_updater_start', baseEvent)
    try {
      const [bin, ...args] = argv
      // Ant explicitly sets `HOMEBREW_NO_AUTO_UPDATE: ""` for homebrew
      // — overrides any user setting so `brew upgrade` first refreshes
      // its tap metadata. Without this, the version we just fetched
      // from formulae.brew.sh might not even be in the local cask
      // database yet → "no upgrade available" false negative.
      const env =
        pm === 'homebrew'
          ? { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '' }
          : undefined
      const { stdout, stderr } = await execFileAsync(bin!, args, {
        cwd: homedir(),
        timeout: PKG_UPDATE_TIMEOUT_MS,
        env,
      })
      const latencyMs = Date.now() - start
      onChangeIsUpdating(false)
      logEvent('tengu_pkg_manager_auto_updater_success', {
        ...baseEvent,
        latency_ms: latencyMs,
      })
      onAutoUpdaterResult({ version: latest, status: 'success' })
      logForDebugging(
        `PackageManagerAutoUpdater: success (${pm}, ${latencyMs}ms): ${stdout || stderr}`,
      )
    } catch (e) {
      const latencyMs = Date.now() - start
      onChangeIsUpdating(false)
      const exitCode = (e as { code?: number }).code ?? -1
      logEvent('tengu_pkg_manager_auto_updater_fail', {
        ...baseEvent,
        latency_ms: latencyMs,
        exit_code: exitCode,
      })
      // Ant `YyK = Date.now()` — capture the failure timestamp so the
      // next 30 minutes are blocked from re-firing.
      lastFailureAtRef.current = Date.now()
      onAutoUpdaterResult({ version: latest, status: 'install_failed' })
      logForDebugging(
        `PackageManagerAutoUpdater: ${argv[0]} exited ${exitCode}: ${(e as Error).message}`,
      )
    }
  }, [onAutoUpdaterResult, onChangeIsUpdating])

  // Initial check
  React.useEffect(() => {
    void checkForUpdates()
  }, [checkForUpdates])

  // Check every 30 minutes (ant wyK = 1800000)
  useInterval(checkForUpdates, PKG_UPDATE_BACKOFF_MS)

  // Render branches mirror ant `MyK`:
  //   success → "✓ Update installed via X · Restart to apply"
  //   updating → "Updating via X…" (or "Updating…" when pm unknown)
  //   else if update-available or last-install-failed →
  //          "Update available! Run: <command> (auto-update failed)?"
  //   else → null
  if (autoUpdaterResult?.status === 'success' && showSuccessMessage) {
    const viaText = packageManager === 'unknown' ? '' : ` via ${packageManager}`
    return (
      <Text color="success" wrap="truncate">
        ✓ Update installed{viaText} · Restart to apply
      </Text>
    )
  }
  if (isUpdating) {
    return (
      <Text dimColor wrap="truncate">
        {packageManager === 'unknown'
          ? 'Updating…'
          : `Updating via ${packageManager}…`}
      </Text>
    )
  }
  const failed = autoUpdaterResult?.status === 'install_failed'
  if (!updateAvailable && !failed) return null
  if (packageManager === 'unknown') return null

  const updateCommand = buildUpdateCommand(packageManager, brewFormulaName)

  return (
    <>
      {verbose && (
        <Text dimColor wrap="truncate">
          currentVersion: {MACRO.VERSION}
        </Text>
      )}
      <Text color="warning" wrap="truncate">
        Update available! Run: <Text bold>{updateCommand}</Text>
        {failed ? <Text dimColor> (auto-update failed)</Text> : null}
      </Text>
    </>
  )
}
