// Leaf module: platform detection helpers shared between
// installer.ts and download.ts. Extracted to break the
// installer ↔ download cycle (installer imports downloadVersion;
// download needed getBinaryName/getPlatform back).

import { env } from '@claude-code/config/env'
import { envDynamic } from '@claude-code/config/env/dynamic'
import { logForDebugging } from '@claude-code/local-observability/debug.js'

export function getPlatform(): string {
  const os = env.platform

  const arch =
    process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : null

  if (!arch) {
    const error = new Error(`Unsupported architecture: ${process.arch}`)
    logForDebugging(
      `Native installer does not support architecture: ${process.arch}`,
      { level: 'error' },
    )
    throw error
  }

  if (os === 'linux' && envDynamic.isMuslEnvironment()) {
    return `linux-${arch}-musl`
  }

  return `${os}-${arch}`
}

export function getBinaryName(platform: string): string {
  return platform.startsWith('win32') ? 'ccb.exe' : 'ccb'
}
