/**
 * Download ripgrep binary from GitHub releases.
 *
 * Run automatically via `bun install` (postinstall hook),
 * or manually: `bun run scripts/download-ripgrep.ts [--force]`
 *
 * Idempotent — skips download if the binary already exists.
 * Use --force to re-download.
 *
 * Environment:
 * - HTTPS_PROXY / HTTP_PROXY — when set, download uses `undici` + EnvHttpProxyAgent.
 * - RIPGREP_DOWNLOAD_BASE — override release URL prefix, e.g. mirror:
 *   `https://ghproxy.net/https://github.com/microsoft/ripgrep-prebuilt/releases/download/v15.0.1`
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'fs'
import { setDefaultResultOrder } from 'node:dns'
import { tmpdir } from 'os'
import { chmodSync } from 'fs'
import { spawnSync } from 'child_process'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Prefer IPv4 first — Bun on Windows sometimes fails GitHub over broken IPv6 paths.
try {
  setDefaultResultOrder('ipv4first')
} catch {
  /* ignore */
}

const RG_VERSION = '15.0.1'
const DEFAULT_RELEASE_BASE = `https://github.com/microsoft/ripgrep-prebuilt/releases/download/v${RG_VERSION}`
const RELEASE_BASE = (process.env.RIPGREP_DOWNLOAD_BASE ?? DEFAULT_RELEASE_BASE).replace(/\/$/, '')

// --- Platform mapping ---

type PlatformMapping = {
  target: string
  ext: 'tar.gz' | 'zip'
}

function getPlatformMapping(): PlatformMapping {
  const arch = process.arch
  const platform = process.platform

  if (platform === 'darwin') {
    if (arch === 'arm64') return { target: 'aarch64-apple-darwin', ext: 'tar.gz' }
    if (arch === 'x64') return { target: 'x86_64-apple-darwin', ext: 'tar.gz' }
    throw new Error(`Unsupported macOS arch: ${arch}`)
  }

  if (platform === 'win32') {
    if (arch === 'x64') return { target: 'x86_64-pc-windows-msvc', ext: 'zip' }
    if (arch === 'arm64') return { target: 'aarch64-pc-windows-msvc', ext: 'zip' }
    throw new Error(`Unsupported Windows arch: ${arch}`)
  }

  if (platform === 'linux') {
    const isMusl = detectMusl()
    if (arch === 'x64') {
      // x64 Linux always uses musl (statically linked, most portable)
      return { target: 'x86_64-unknown-linux-musl', ext: 'tar.gz' }
    }
    if (arch === 'arm64') {
      return isMusl
        ? { target: 'aarch64-unknown-linux-musl', ext: 'tar.gz' }
        : { target: 'aarch64-unknown-linux-gnu', ext: 'tar.gz' }
    }
    throw new Error(`Unsupported Linux arch: ${arch}`)
  }

  throw new Error(`Unsupported platform: ${platform}`)
}

function detectMusl(): boolean {
  const muslArch = process.arch === 'x64' ? 'x86_64' : 'aarch64'
  try {
    statSync(`/lib/libc.musl-${muslArch}.so.1`)
    return true
  } catch {
    return false
  }
}

// --- Target vendor path (must match ripgrep.ts logic) ---

function getVendorDir(): string {
  const packageRoot = path.resolve(__dirname, '..')

  // Dev mode: package root has src/ directory
  // ripgrep.ts at src/utils/ripgrep.ts: __dirname = src/utils/
  // vendor path = src/utils/vendor/ripgrep/
  if (existsSync(path.join(packageRoot, 'src'))) {
    return path.resolve(packageRoot, 'src', 'utils', 'vendor', 'ripgrep')
  }

  // Published mode: compiled chunks are flat in dist/
  // ripgrep chunk at dist/xxxx.js: __dirname = dist/
  // vendor path = dist/vendor/ripgrep/
  return path.resolve(packageRoot, 'dist', 'vendor', 'ripgrep')
}

function getBinaryPath(): string {
  const dir = getVendorDir()
  const subdir = `${process.arch}-${process.platform}`
  const binary = process.platform === 'win32' ? 'rg.exe' : 'rg'
  return path.resolve(dir, subdir, binary)
}

// --- Download & extract ---

function proxyEnvSet(): boolean {
  const v = (s: string | undefined) => (s ?? '').trim()
  return !!(
    v(process.env.HTTPS_PROXY) ||
    v(process.env.HTTP_PROXY) ||
    v(process.env.ALL_PROXY) ||
    v(process.env.https_proxy) ||
    v(process.env.http_proxy)
  )
}

async function fetchRelease(url: string): Promise<Response> {
  if (proxyEnvSet()) {
    const { EnvHttpProxyAgent, fetch: undiciFetch } = await import('undici')
    return (await undiciFetch(url, {
      redirect: 'follow',
      dispatcher: new EnvHttpProxyAgent(),
    })) as unknown as Response
  }
  return await fetch(url, { redirect: 'follow' })
}

function tryPowerShellDownload(url: string, dest: string): boolean {
  const u = url.replace(/'/g, "''")
  const d = dest.replace(/'/g, "''")
  const cmd = `Invoke-WebRequest -Uri '${u}' -OutFile '${d}' -UseBasicParsing`
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
    { stdio: 'pipe', windowsHide: true },
  )
  return result.status === 0 && existsSync(dest) && statSync(dest).size > 0
}

function tryCurlDownload(url: string, dest: string): boolean {
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl'
  const result = spawnSync(curl, ['-fsSL', '-L', '--fail', '-o', dest, url], {
    stdio: 'pipe',
    windowsHide: true,
  })
  return result.status === 0 && existsSync(dest) && statSync(dest).size > 0
}

/** Bun `fetch` on Windows can fail while browser / WinINET still works — use subprocess fallbacks. */
async function downloadUrlToBuffer(url: string): Promise<Buffer> {
  const response = await fetchRelease(url)
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

async function downloadUrlToBufferWithFallback(url: string): Promise<Buffer> {
  let firstError: unknown
  try {
    return await downloadUrlToBuffer(url)
  } catch (e) {
    firstError = e
  }

  const tmpRoot = path.join(tmpdir(), `ripgrep-dl-${process.pid}-${Date.now()}`)
  const tmpFile = path.join(tmpRoot, 'archive')
  mkdirSync(tmpRoot, { recursive: true })
  try {
    if (process.platform === 'win32' && tryPowerShellDownload(url, tmpFile)) {
      return readFileSync(tmpFile)
    }
    if (tryCurlDownload(url, tmpFile)) {
      return readFileSync(tmpFile)
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true })
  }

  throw firstError
}

function findZipEntryKey(files: Record<string, Uint8Array>, want: string): string | undefined {
  return Object.keys(files).find(k => {
    const norm = k.replace(/\\/g, '/')
    return norm === want || norm.endsWith(`/${want}`)
  })
}

async function downloadAndExtract(): Promise<void> {
  const { target, ext } = getPlatformMapping()
  const assetName = `ripgrep-v${RG_VERSION}-${target}.${ext}`
  const downloadUrl = `${RELEASE_BASE}/${assetName}`

  const binaryPath = getBinaryPath()
  const binaryDir = path.dirname(binaryPath)

  // Idempotent: skip if binary exists and has content
  const force = process.argv.includes('--force')
  if (!force && existsSync(binaryPath)) {
    const stat = statSync(binaryPath)
    if (stat.size > 0) {
      console.log(`[ripgrep] Binary already exists at ${binaryPath}, skipping.`)
      return
    }
  }

  console.log(`[ripgrep] Downloading v${RG_VERSION} for ${target}...`)
  console.log(`[ripgrep] URL: ${downloadUrl}`)

  const extractedBinary = process.platform === 'win32' ? 'rg.exe' : 'rg'
  const { writeFileSync } = await import('fs')

  try {
    const buffer = await downloadUrlToBufferWithFallback(downloadUrl)
    console.log(`[ripgrep] Downloaded ${Math.round(buffer.length / 1024)} KB`)

    mkdirSync(binaryDir, { recursive: true })

    if (ext === 'tar.gz') {
      const tmpDir = path.join(binaryDir, '.tmp-download')
      rmSync(tmpDir, { recursive: true, force: true })
      mkdirSync(tmpDir, { recursive: true })
      try {
        const archivePath = path.join(tmpDir, assetName)
        writeFileSync(archivePath, buffer)
        const result = spawnSync('tar', ['xzf', archivePath, '-C', tmpDir], {
          stdio: 'pipe',
        })
        if (result.status !== 0) {
          throw new Error(`tar extract failed: ${result.stderr?.toString()}`)
        }
        const srcBinary = path.join(tmpDir, extractedBinary)
        if (!existsSync(srcBinary)) {
          throw new Error(`Binary not found at expected path: ${srcBinary}`)
        }
        renameSync(srcBinary, binaryPath)
      } finally {
        rmSync(tmpDir, { recursive: true, force: true })
      }
    } else {
      let fflateError: unknown
      try {
        const { unzipSync } = await import('fflate')
        const unzipped = unzipSync(new Uint8Array(buffer))
        const key = findZipEntryKey(unzipped, extractedBinary)
        if (!key) {
          throw new Error(`Binary ${extractedBinary} not found in zip`)
        }
        writeFileSync(binaryPath, Buffer.from(unzipped[key]))
        fflateError = undefined
      } catch (e) {
        fflateError = e
      }

      if (fflateError) {
        // fflate failed — try PowerShell Expand-Archive on Windows, then unzip CLI
        const tmpDir = path.join(binaryDir, '.tmp-download')
        rmSync(tmpDir, { recursive: true, force: true })
        mkdirSync(tmpDir, { recursive: true })
        try {
          const archivePath = path.join(tmpDir, assetName)
          writeFileSync(archivePath, buffer)

          let extracted = false

          // On Windows, prefer PowerShell Expand-Archive
          if (process.platform === 'win32') {
            const psCmd = `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${tmpDir.replace(/'/g, "''")}' -Force`
            const psResult = spawnSync(
              'powershell.exe',
              ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psCmd],
              { stdio: 'pipe', windowsHide: true },
            )
            if (psResult.status === 0) {
              extracted = true
            } else {
              const psErr = psResult.stderr?.toString().trim() || 'unknown error'
              console.log(`[ripgrep] PowerShell Expand-Archive failed: ${psErr}`)
            }
          }

          // Fallback: unzip CLI (Git for Windows, MSYS2, or Unix)
          if (!extracted) {
            const result = spawnSync('unzip', ['-o', archivePath, '-d', tmpDir], {
              stdio: 'pipe',
            })
            if (result.status !== 0) {
              const unzipErr = result.stderr?.toString().trim() || 'command not found'
              const fflateMsg = fflateError instanceof Error ? fflateError.message : String(fflateError)
              throw new Error(`zip extraction failed (fflate: ${fflateMsg}; unzip: ${unzipErr})`)
            }
          }

          const srcBinary = path.join(tmpDir, extractedBinary)
          if (!existsSync(srcBinary)) {
            throw new Error(`Binary not found at expected path: ${srcBinary}`)
          }
          renameSync(srcBinary, binaryPath)
        } finally {
          rmSync(tmpDir, { recursive: true, force: true })
        }
      }
    }

    if (process.platform !== 'win32') {
      chmodSync(binaryPath, 0o755)
    }

    console.log(`[ripgrep] Installed to ${binaryPath}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const hint =
      'Check network or set HTTPS_PROXY. If GitHub is blocked, set RIPGREP_DOWNLOAD_BASE to a mirror (see script header).'
    throw new Error(`${msg} ${hint}`)
  }
}

// --- Main ---

downloadAndExtract().catch(error => {
  console.error(`[ripgrep] Download failed: ${error.message}`)
  console.error(`[ripgrep] You can install ripgrep manually: https://github.com/BurntSushi/ripgrep#installation`)
  // Don't exit with error code — postinstall should not break bun install
  process.exit(0)
})
