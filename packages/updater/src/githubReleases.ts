// GitHub Releases adapter for the auto-updater. Replaces the GCS bucket
// path that upstream Anthropic used. Single source of truth for "what
// repo + asset naming convention does ccb publish under?".

import axios from 'axios'
import { logEvent } from '@claude-code/local-observability'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { logError } from '@claude-code/local-observability/log.js'
import type { NpmDistTags } from './autoUpdater.js'
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

/**
 * The web (non-API) "latest release" URL. A GET against this returns a
 * 302 whose `Location` is `.../releases/tag/<tag>`. Crucially this path
 * is served by github.com, NOT api.github.com, so it is NOT subject to
 * the 60-requests/hour unauthenticated API rate limit. install.sh uses
 * exactly this redirect to resolve "latest" — the in-app auto-updater
 * now does too, so both agree and neither dies on a shared-IP 403.
 */
function getReleasesWebLatestUrl(): string {
  return `https://github.com/${getRepo()}/releases/latest`
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
 * Parse a GitHub `.../releases/tag/<tag>` URL (the `Location` of the
 * web "latest" redirect) and return the bare `<tag>` segment, or null
 * if the URL doesn't match that shape. Exported for unit testing.
 */
export function parseTagFromReleaseLocation(location: string): string | null {
  // Accept both absolute (https://github.com/o/r/releases/tag/v1.2.3)
  // and the rare relative form (/o/r/releases/tag/v1.2.3). Strip any
  // query/hash. The tag is the final path segment after `/tag/`.
  const match = location.match(/\/releases\/tag\/([^/?#]+)/)
  if (!match) return null
  const tag = decodeURIComponent(match[1]!).trim()
  return tag.length > 0 ? tag : null
}

/**
 * Resolve the latest release tag.
 *
 * Default path is the github.com web redirect (`/releases/latest` → 302
 * `Location: /releases/tag/<tag>`), which is NOT rate-limited the way
 * api.github.com is. This matters because the unauthenticated GitHub
 * *API* allows only 60 requests/hour PER IP — on a shared/NAT'd IP that
 * budget is routinely exhausted by unrelated traffic, and the auto-
 * updater would then get a 403 on every launch and silently never
 * update. install.sh already resolves "latest" via this same redirect;
 * aligning the in-app updater removes that asymmetry. (Verified: the
 * web redirect returns no x-ratelimit-* headers.)
 *
 * When GITHUB_TOKEN is set we prefer the API (5000/h authenticated, and
 * it returns structured JSON) — CI runners set this; end users rarely do.
 *
 * Returns the tag string (e.g. "v26.5.92") with the leading "v"
 * preserved — callers strip it if they need a bare version number.
 */
export async function fetchLatestReleaseTag(): Promise<string> {
  if (process.env.GITHUB_TOKEN) {
    return fetchLatestReleaseTagViaApi()
  }
  return fetchLatestReleaseTagViaRedirect()
}

/**
 * Resolve latest tag via the github.com web redirect (no API rate
 * limit). axios is told NOT to follow the redirect (maxRedirects: 0) so
 * we can read the 302 `Location` header ourselves.
 */
async function fetchLatestReleaseTagViaRedirect(): Promise<string> {
  const url = getReleasesWebLatestUrl()
  const startTime = Date.now()
  try {
    const response = await axios.get(url, {
      timeout: 30_000,
      maxRedirects: 0,
      // 302/301 = the redirect we want. 404 = no releases (fresh fork).
      // 200 would mean GitHub served the page directly without a
      // redirect (no release exists) — handled below as "no location".
      validateStatus: status =>
        status === 302 || status === 301 || status === 200 || status === 404,
    })
    const latencyMs = Date.now() - startTime

    if (response.status === 404) {
      logEvent('tengu_version_check_no_releases', {})
      throw new Error('No releases published for this repository.')
    }

    const location =
      (response.headers?.location as string | undefined) ??
      (response.headers?.Location as string | undefined)
    const tag = location ? parseTagFromReleaseLocation(location) : null
    if (!tag) {
      // No redirect target (e.g. a repo with zero releases serves the
      // releases index at 200 with no tag) — treat as "no release".
      logEvent('tengu_version_check_no_releases', {})
      throw new Error(
        `No release tag found in redirect from ${url} (location: ${location ?? 'none'})`,
      )
    }

    logEvent('tengu_version_check_success', { latency_ms: latencyMs })
    logForDebugging(`[githubReleases] latest tag (redirect): ${tag}`)
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
 * Resolve latest tag via the authenticated GitHub API (5000/h). Only
 * used when GITHUB_TOKEN is present. Returns structured JSON, so we read
 * `tag_name` directly.
 */
async function fetchLatestReleaseTagViaApi(): Promise<string> {
  const url = `${getReleasesApiUrl()}/latest`
  const startTime = Date.now()
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
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
    logForDebugging(`[githubReleases] latest tag (api): ${tag}`)
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

/**
 * Dist-tags for ccb native installs (the doctor "Updates" panel).
 *
 * ccb publishes to GitHub Releases, NOT the Anthropic GCS bucket — so a
 * native ccb install must resolve its "latest" from GitHub. Previously
 * the doctor screen called getGcsDistTags() for ALL native installs,
 * which made ccb report Anthropic's upstream version (e.g. "2.1.150")
 * instead of its own (e.g. "26.5.92"). That number is both wrong and
 * unreachable (26.x > 2.x, so isVersionNewer never fires), which made it
 * look like an update existed that could never install.
 *
 * ccb has no separate "stable" vs "latest" channel — both map to the
 * single GitHub "latest" release. The leading "v" is stripped so the
 * value lines up with MACRO.VERSION ("26.5.92", not "v26.5.92").
 */
export async function getGithubDistTags(): Promise<NpmDistTags> {
  try {
    const tag = await fetchLatestReleaseTag()
    const version = tag.startsWith('v') ? tag.slice(1) : tag
    return { latest: version, stable: version }
  } catch (error) {
    logForDebugging(`getGithubDistTags: GitHub fetch failed: ${error}`)
    return { latest: null, stable: null }
  }
}
