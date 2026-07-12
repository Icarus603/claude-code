/**
 * Download functionality for native installer
 *
 * Handles downloading Claude binaries from various sources:
 * - Artifactory NPM packages
 * - GCS bucket
 */

import { feature } from 'bun:bundle'
import axios from 'axios'
import { join } from 'path'
import { logEvent } from '@claude-code/local-observability'
import type { ReleaseChannel } from '@claude-code/config'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { execFileNoThrowWithCwd } from '@claude-code/shell/execFileNoThrow.js'
import { getFsImplementation } from '@claude-code/storage/fsOperations.js'
import { logError } from '@claude-code/local-observability/log.js'
import { jsonStringify, writeFileSync } from '@claude-code/local-observability/slowOperations.js'
import { getBinaryName, getPlatform } from './platform.js'
import { streamBinaryDownload } from './streamBinaryDownload.js'

const GCS_BUCKET_URL =
  'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases'
const ARTIFACTORY_REGISTRY_URL =
  'https://artifactory.infra.ant.dev/artifactory/api/npm/npm-all/'

async function getLatestVersionFromArtifactory(
  tag: string = 'latest',
): Promise<string> {
  const startTime = Date.now()
  const { stdout, code, stderr } = await execFileNoThrowWithCwd(
    'npm',
    [
      'view',
      `${MACRO.NATIVE_PACKAGE_URL}@${tag}`,
      'version',
      '--prefer-online',
      '--registry',
      ARTIFACTORY_REGISTRY_URL,
    ],
    {
      timeout: 30000,
      preserveOutputOnError: true,
    },
  )

  const latencyMs = Date.now() - startTime

  if (code !== 0) {
    logEvent('tengu_version_check_failure', {
      latency_ms: latencyMs,
      source_npm: true,
      exit_code: code,
    })
    const error = new Error(`npm view failed with code ${code}: ${stderr}`)
    logError(error)
    throw error
  }

  logEvent('tengu_version_check_success', {
    latency_ms: latencyMs,
    source_npm: true,
  })
  logForDebugging(
    `npm view ${MACRO.NATIVE_PACKAGE_URL}@${tag} version: ${stdout}`,
  )
  const latestVersion = stdout.trim()
  return latestVersion
}

export async function getLatestVersion(
  channelOrVersion: string,
): Promise<string> {
  // Direct version: ccb's "v1.carus.NNN" format OR upstream "1.0.30" semver.
  // Both are accepted as direct overrides — useful for `ccb install <version>`.
  if (
    /^v?\d+\.[a-z0-9]+\.\w+(-\S+)?$/i.test(channelOrVersion) ||
    /^v?\d+\.\d+\.\d+(-\S+)?$/.test(channelOrVersion)
  ) {
    const normalized = channelOrVersion.startsWith('v')
      ? channelOrVersion.slice(1)
      : channelOrVersion
    if (/^99\.99\./.test(normalized) && !feature('ALLOW_TEST_VERSIONS')) {
      throw new Error(
        `Version ${normalized} is not available for installation. Use 'stable' or 'latest'.`,
      )
    }
    return normalized
  }

  // ReleaseChannel validation
  const channel = channelOrVersion as ReleaseChannel
  if (channel !== 'stable' && channel !== 'latest') {
    throw new Error(
      `Invalid channel: ${channelOrVersion}. Use 'stable' or 'latest'`,
    )
  }

  // Ant-internal users still hit Artifactory.
  if (process.env.USER_TYPE === 'ant') {
    const npmTag = channel === 'stable' ? 'stable' : 'latest'
    return getLatestVersionFromArtifactory(npmTag)
  }

  // ccb default: GitHub Releases. The "stable" channel currently maps to
  // "latest" too — distinguishing requires a tag-naming convention we
  // haven't established.
  const { fetchLatestReleaseTag } = await import('../githubReleases.js')
  const tag = await fetchLatestReleaseTag()
  // Strip leading "v" so version comparisons against MACRO.VERSION work
  // (MACRO.VERSION is "1.carus.000", not "v1.carus.000").
  return tag.startsWith('v') ? tag.slice(1) : tag
}

async function downloadVersionFromArtifactory(
  version: string,
  stagingPath: string,
) {
  const fs = getFsImplementation()

  // If we get here, we own the lock and can delete a partial download
  await fs.rm(stagingPath, { recursive: true, force: true })

  // Get the platform-specific package name
  const platform = getPlatform()
  const platformPackageName = `${MACRO.NATIVE_PACKAGE_URL}-${platform}`

  // Fetch integrity hash for the platform-specific package
  logForDebugging(
    `Fetching integrity hash for ${platformPackageName}@${version}`,
  )
  const {
    stdout: integrityOutput,
    code,
    stderr,
  } = await execFileNoThrowWithCwd(
    'npm',
    [
      'view',
      `${platformPackageName}@${version}`,
      'dist.integrity',
      '--registry',
      ARTIFACTORY_REGISTRY_URL,
    ],
    {
      timeout: 30000,
      preserveOutputOnError: true,
    },
  )

  if (code !== 0) {
    throw new Error(`npm view integrity failed with code ${code}: ${stderr}`)
  }

  const integrity = integrityOutput.trim()
  if (!integrity) {
    throw new Error(
      `Failed to fetch integrity hash for ${platformPackageName}@${version}`,
    )
  }

  logForDebugging(`Got integrity hash for ${platform}: ${integrity}`)

  // Create isolated npm project in staging
  await fs.mkdir(stagingPath)

  const packageJson = {
    name: 'claude-native-installer',
    version: '0.0.1',
    dependencies: {
      [MACRO.NATIVE_PACKAGE_URL!]: version,
    },
  }

  // Create package-lock.json with integrity verification for platform-specific package
  const packageLock = {
    name: 'claude-native-installer',
    version: '0.0.1',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'claude-native-installer',
        version: '0.0.1',
        dependencies: {
          [MACRO.NATIVE_PACKAGE_URL!]: version,
        },
      },
      [`node_modules/${MACRO.NATIVE_PACKAGE_URL}`]: {
        version: version,
        optionalDependencies: {
          [platformPackageName]: version,
        },
      },
      [`node_modules/${platformPackageName}`]: {
        version: version,
        integrity: integrity,
      },
    },
  }

  writeFileSync(
    join(stagingPath, 'package.json'),
    jsonStringify(packageJson, null, 2),
    { encoding: 'utf8', flush: true },
  )

  writeFileSync(
    join(stagingPath, 'package-lock.json'),
    jsonStringify(packageLock, null, 2),
    { encoding: 'utf8', flush: true },
  )

  // Install with npm - it will verify integrity from package-lock.json
  // Use --prefer-online to force fresh metadata checks, helping with Artifactory replication delays
  const result = await execFileNoThrowWithCwd(
    'npm',
    ['ci', '--prefer-online', '--registry', ARTIFACTORY_REGISTRY_URL],
    {
      timeout: 60000,
      preserveOutputOnError: true,
      cwd: stagingPath,
    },
  )

  if (result.code !== 0) {
    throw new Error(`npm ci failed with code ${result.code}: ${result.stderr}`)
  }

  logForDebugging(
    `Successfully downloaded and verified ${MACRO.NATIVE_PACKAGE_URL}@${version}`,
  )
}

// Stall timeout: abort if no bytes received for this duration
const DEFAULT_STALL_TIMEOUT_MS = 60000 // 60 seconds
function getStallTimeoutMs(): number {
  return (
    Number(process.env.CLAUDE_CODE_STALL_TIMEOUT_MS_FOR_TESTING) ||
    DEFAULT_STALL_TIMEOUT_MS
  )
}

/**
 * Common logic for downloading and verifying a binary.
 * Includes stall detection (aborts if no bytes for 60s) and retry logic.
 */
async function downloadAndVerifyBinary(
  binaryUrl: string,
  expectedChecksum: string,
  binaryPath: string,
  requestConfig: Record<string, unknown> = {},
  skipChecksum: boolean = false,
) {
  await streamBinaryDownload({
    binaryUrl,
    expectedChecksum,
    binaryPath,
    requestConfig,
    skipChecksum,
    stallTimeoutMs: getStallTimeoutMs(),
  })
}

async function downloadVersionFromBinaryRepo(
  version: string,
  stagingPath: string,
  baseUrl: string,
  authConfig?: {
    auth?: { username: string; password: string }
    headers?: Record<string, string>
  },
) {
  const fs = getFsImplementation()

  // If we get here, we own the lock and can delete a partial download
  await fs.rm(stagingPath, { recursive: true, force: true })

  // Get platform
  const platform = getPlatform()
  const startTime = Date.now()

  // Log download attempt start
  logEvent('tengu_binary_download_attempt', {})

  // Fetch manifest to get checksum
  let manifest
  try {
    const manifestResponse = await axios.get(
      `${baseUrl}/${version}/manifest.json`,
      {
        timeout: 10000,
        responseType: 'json',
        ...authConfig,
      },
    )
    manifest = manifestResponse.data
  } catch (error) {
    const latencyMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    let httpStatus: number | undefined
    if (axios.isAxiosError(error) && error.response) {
      httpStatus = error.response.status
    }

    logEvent('tengu_binary_manifest_fetch_failure', {
      latency_ms: latencyMs,
      http_status: httpStatus,
      is_timeout: errorMessage.includes('timeout'),
    })
    logError(
      new Error(
        `Failed to fetch manifest from ${baseUrl}/${version}/manifest.json: ${errorMessage}`,
      ),
    )
    throw error
  }

  const platformInfo = manifest.platforms[platform]

  if (!platformInfo) {
    logEvent('tengu_binary_platform_not_found', {})
    throw new Error(
      `Platform ${platform} not found in manifest for version ${version}`,
    )
  }

  const expectedChecksum = platformInfo.checksum

  // Both GCS and generic bucket use identical layout: ${baseUrl}/${version}/${platform}/${binaryName}
  const binaryName = getBinaryName(platform)
  const binaryUrl = `${baseUrl}/${version}/${platform}/${binaryName}`

  // Write to staging
  await fs.mkdir(stagingPath)
  const binaryPath = join(stagingPath, binaryName)

  try {
    await downloadAndVerifyBinary(
      binaryUrl,
      expectedChecksum,
      binaryPath,
      authConfig || {},
    )
    const latencyMs = Date.now() - startTime
    logEvent('tengu_binary_download_success', {
      latency_ms: latencyMs,
    })
  } catch (error) {
    const latencyMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    let httpStatus: number | undefined
    if (axios.isAxiosError(error) && error.response) {
      httpStatus = error.response.status
    }

    logEvent('tengu_binary_download_failure', {
      latency_ms: latencyMs,
      http_status: httpStatus,
      is_timeout: errorMessage.includes('timeout'),
      is_checksum_mismatch: errorMessage.includes('Checksum mismatch'),
    })
    logError(
      new Error(`Failed to download binary from ${binaryUrl}: ${errorMessage}`),
    )
    throw error
  }
}

export async function downloadVersion(
  version: string,
  stagingPath: string,
): Promise<'npm' | 'binary'> {
  // Test-fixture versions route to the private sentinel bucket. DCE'd in all
  // shipped builds — the string 'claude-code-ci-sentinel' and the gcloud call
  // never exist in compiled binaries.
  if (feature('ALLOW_TEST_VERSIONS') && /^99\.99\./.test(version)) {
    const { stdout } = await execFileNoThrowWithCwd('gcloud', [
      'auth',
      'print-access-token',
    ])
    await downloadVersionFromBinaryRepo(
      version,
      stagingPath,
      'https://storage.googleapis.com/claude-code-ci-sentinel',
      { headers: { Authorization: `Bearer ${stdout.trim()}` } },
    )
    return 'binary'
  }

  if (process.env.USER_TYPE === 'ant') {
    await downloadVersionFromArtifactory(version, stagingPath)
    return 'npm'
  }

  // ccb default: download platform-specific binary from GitHub Releases.
  await downloadVersionFromGithubReleases(version, stagingPath)
  return 'binary'
}

/**
 * GitHub Releases adapter for ccb. Different from upstream's
 * downloadVersionFromBinaryRepo (which expects a manifest.json with
 * per-platform checksums) — GitHub Releases stores each platform binary
 * as a flat asset, with optional sibling .sha256 files for verification.
 */
async function downloadVersionFromGithubReleases(
  version: string,
  stagingPath: string,
): Promise<void> {
  const fs = getFsImplementation()
  await fs.rm(stagingPath, { recursive: true, force: true })

  const platform = getPlatform()
  const startTime = Date.now()
  logEvent('tengu_binary_download_attempt', {})

  const { fetchAssetSha256, getAssetDownloadUrl, getAssetNameForPlatform } =
    await import('../githubReleases.js')

  // Tag form on GitHub is "v<version>"; we accept both forms in
  // download.ts callers, so always re-prepend v if missing.
  const tag = version.startsWith('v') ? version : `v${version}`
  const assetName = getAssetNameForPlatform(platform)
  const binaryUrl = getAssetDownloadUrl(tag, assetName)

  // .sha256 sibling enforcement:
  //   - v26.x.x and later: REQUIRED. release.yml emits .sha256 for every
  //     binary; if fetch returns null on a v26+ tag, that's either a broken
  //     release (refuse to install) or an active MITM strip attack on the
  //     checksum file (refuse harder).
  //   - v1.carus.000: only historical release without .sha256 (released
  //     before checksum step was wired). All later v1.carus.NNN have it.
  //     Auto-update has long since moved everyone past this version.
  //   - Other unrecognised tag forms: TLS-only fallback (defensive — should
  //     not occur in practice since download is gated by isVersionNewer).
  // Audit run 2026-05-04: 107/107 releases checked, only v1.carus.000 lacks
  // .sha256 — confirms the safety of this gate.
  const expectedChecksum = await fetchAssetSha256(tag, assetName)
  // Major ≥ 10. Excludes v1.x (legacy carus + ant upstream) and v2-v9.
  // ccb's CalVer scheme is v<2-digit-year>.<month>.<n>, so any major ≥ 10
  // is a ccb release — none of which has shipped without .sha256 except
  // the very first v1.carus.000.
  const isModernTag = /^v(?:[1-9]\d+|\d{3,})\./.test(tag)
  if (expectedChecksum === null && isModernTag) {
    throw new Error(
      `Refusing to install ${tag}: missing .sha256 sibling. ` +
        `Modern releases (v26+) must publish a checksum file. ` +
        `Either the release is broken or the checksum was stripped in transit.`,
    )
  }

  // Local layout matches Anthropic upstream: `staging/<version>/<binaryName>`.
  // installer.ts then atomic-moves the binary to `versions/<version>` (a
  // file, not a dir — getVersionPaths flattens before publish).
  const binaryName = getBinaryName(platform)
  await fs.mkdir(stagingPath)
  const binaryPath = join(stagingPath, binaryName)

  try {
    await downloadAndVerifyBinary(
      binaryUrl,
      expectedChecksum ?? '',
      binaryPath,
      {},
      // Only legacy v1.carus.000-style tags reach this branch with null —
      // modern tags throw above.
      expectedChecksum === null,
    )
    const latencyMs = Date.now() - startTime
    logEvent('tengu_binary_download_success', { latency_ms: latencyMs })
  } catch (error) {
    const latencyMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    let httpStatus: number | undefined
    if (axios.isAxiosError(error) && error.response) {
      httpStatus = error.response.status
    }
    logEvent('tengu_binary_download_failure', {
      latency_ms: latencyMs,
      http_status: httpStatus,
      is_timeout: errorMessage.includes('timeout'),
      is_checksum_mismatch: errorMessage.includes('Checksum mismatch'),
    })
    logError(
      new Error(`Failed to download ${binaryUrl}: ${errorMessage}`),
    )
    throw error
  }
}
