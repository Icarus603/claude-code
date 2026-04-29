// GitHub Releases adapter for the auto-updater. Replaces the GCS bucket
// path that upstream Anthropic used. Single source of truth for "what
// repo + asset naming convention does ccb publish under?".

import axios from 'axios'
import { logEvent } from '@claude-code/local-observability'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { logError } from '@claude-code/local-observability/log.js'
import { getPlatform } from './nativeInstaller/platform.js'

// Hard-coded — this is the repo where ccb releases are published.
// Override via CCB_RELEASES_REPO env for forks/testing.
const DEFAULT_REPO = 'Icarus603/claude-code'

function getRepo(): string {
  return process.env.CCB_RELEASES_REPO || DEFAULT_REPO
}

function getReleasesApiUrl(): string {
  return `https://api.github.com/repos/${getRepo()}/releases`
}

export function getAssetDownloadUrl(tag: string, assetName: string): string {
  return `https://github.com/${getRepo()}/releases/download/${tag}/${assetName}`
}

/**
 * Map our internal platform string (darwin-arm64, linux-x64, ...) to the
 * release asset filename. Mirrors scripts/build-platforms.ts. Windows
 * binaries get a `.exe` suffix on the asset side; the local binary
 * dropped into `versions/<v>` does NOT include the suffix because the
 * platform is the local machine's platform — ccb running on Windows
 * already knows it's Windows.
 */
export function getAssetNameForPlatform(platform: string = getPlatform()): string {
  // Strip musl suffix — release assets only ship glibc Linux for now.
  const normalized = platform.replace(/-musl$/, '')
  if (normalized.startsWith('win32')) {
    // Bun's getPlatform() returns "win32-x64"; our release asset is "ccb-windows-x64.exe".
    return 'ccb-windows-x64.exe'
  }
  return `ccb-${normalized}`
}

/**
 * GET /repos/<owner>/<repo>/releases/latest → release tag.
 * Honors GITHUB_TOKEN for authenticated rate limits (60→5000/h).
 *
 * Returns the tag string (e.g. "v1.carus.000"), with the leading "v"
 * preserved — callers should strip if they need a bare version number.
 */
export async function fetchLatestReleaseTag(): Promise<string> {
  const url = `${getReleasesApiUrl()}/latest`
  const startTime = Date.now()
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  // Authenticated requests get a 5000/h rate limit instead of 60/h.
  // CI runners commonly set GITHUB_TOKEN; end users typically don't.
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  try {
    const response = await axios.get(url, {
      timeout: 30_000,
      headers,
      validateStatus: status => status === 200 || status === 404,
    })
    const latencyMs = Date.now() - startTime

    if (response.status === 404) {
      // No releases published yet (fresh fork) — treat as "no update available".
      logEvent('tengu_version_check_no_releases', {})
      throw new Error('No releases published for this repository.')
    }

    const tag = (response.data?.tag_name as string | undefined)?.trim()
    if (!tag) {
      throw new Error(
        `GitHub API returned no tag_name in response from ${url}`,
      )
    }

    logEvent('tengu_version_check_success', { latency_ms: latencyMs })
    logForDebugging(`[githubReleases] latest tag: ${tag}`)
    return tag
  } catch (error) {
    const latencyMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    let httpStatus: number | undefined
    if (axios.isAxiosError(error) && error.response) {
      httpStatus = error.response.status
    }
    logEvent('tengu_version_check_failure', {
      latency_ms: latencyMs,
      http_status: httpStatus,
      is_timeout: errorMessage.includes('timeout'),
    })
    const wrapped = new Error(
      `Failed to fetch latest release from ${url}: ${errorMessage}`,
    )
    logError(wrapped)
    throw wrapped
  }
}

/**
 * Fetch the SHA256 checksum for a given asset, if one is published.
 * Convention: each binary asset `ccb-<platform>` has a sibling
 * `ccb-<platform>.sha256` with the format `<hex>  <filename>`.
 *
 * Returns null if no checksum file exists — caller should treat as
 * "trust the download" (still TLS-verified, just not content-pinned).
 */
export async function fetchAssetSha256(
  tag: string,
  assetName: string,
): Promise<string | null> {
  const url = getAssetDownloadUrl(tag, `${assetName}.sha256`)
  try {
    const response = await axios.get(url, {
      timeout: 10_000,
      responseType: 'text',
      validateStatus: s => s === 200 || s === 404,
    })
    if (response.status === 404) {
      logForDebugging(`[githubReleases] no .sha256 for ${assetName} (skipping verify)`)
      return null
    }
    // Parse `<hex>  <filename>` shasum-format output. Take the first 64-hex token.
    const match = String(response.data).match(/\b[0-9a-f]{64}\b/i)
    return match?.[0] ?? null
  } catch (error) {
    logForDebugging(
      `[githubReleases] sha256 fetch failed for ${assetName}: ${error}`,
    )
    return null
  }
}
