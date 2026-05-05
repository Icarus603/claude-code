/**
 * Resolve a ripgrep path the sandbox-runtime can spawn.
 *
 * Sandbox-runtime takes rg as an external binary because it's a separate
 * process — NAPI doesn't help here. Three paths:
 *
 *   - Linux + standalone binary: extract the embedded rg to tmp on first
 *     call (sandbox-runtime needs an actual file on disk to spawn)
 *   - Linux + dev mode: use the vendored on-disk rg from this checkout
 *   - macOS / Windows: any path works — macOS sandbox uses native
 *     profile globs and never shells out; Windows doesn't support
 *     sandboxing at all
 *
 * Lifted out of sandbox-adapter.ts to keep its LOC budget honest. The
 * sandbox-rg edge case is small but unavoidable as long as
 * @anthropic-ai/sandbox-runtime takes rg as a config value.
 */
import { join } from 'path'
import { fileURLToPath } from 'url'

import { isInBundledMode } from '@claude-code/config/bundledMode'
import { ensureExtractedRipgrepForSandbox } from '@claude-code/tool-registry/embeddedRgExtractor.js'

export function getSandboxRipgrep(): { rgPath: string; rgArgs: string[] } {
  if (process.platform === 'linux') {
    const extracted = ensureExtractedRipgrepForSandbox()
    if (extracted) {
      return { rgPath: extracted, rgArgs: [] }
    }
    // Dev mode fallback: vendored rg next to this module's source tree.
    if (!isInBundledMode()) {
      const here = fileURLToPath(import.meta.url)
      const vendorDir = join(
        here,
        '..',
        '..',
        '..',
        'vendor',
        'ripgrep',
        `${process.arch}-linux`,
      )
      return { rgPath: join(vendorDir, 'rg'), rgArgs: [] }
    }
  }
  return { rgPath: 'rg', rgArgs: [] }
}
