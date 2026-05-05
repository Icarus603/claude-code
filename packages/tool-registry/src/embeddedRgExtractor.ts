/**
 * Sandbox-only ripgrep binary extractor.
 *
 * Background: ccb's main ripgrep path is `ripgrep-napi` (in-process,
 * no spawn). But @anthropic-ai/sandbox-runtime's Linux backend invokes
 * rg as an external command to compute filesystem deny paths — it
 * needs an actual file on disk it can `posix_spawn`. NAPI doesn't help
 * here because the sandbox is a *separate process* from ccb.
 *
 * For that one Linux + sandbox-enabled case (opt-in, ~rare), we embed
 * the platform's vendored rg binary into the standalone executable
 * via `with { type: "file" }` and extract on demand.
 *
 * On macOS (sandbox profile uses native glob primitives, no rg) and
 * Windows (sandbox not supported), this returns null.
 *
 * Cache: `os.tmpdir()/ccb-sandbox-rg-<sha16>`. Ephemeral —
 * OS clears tmp eventually, restart wipes it. SHA matches the
 * embedded bytes so binary upgrades miss the old cache and re-extract.
 */
import { createHash } from 'crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { isInBundledMode } from '@claude-code/config/bundledMode'
import { logForDebugging } from '@claude-code/local-observability/debug.js'

declare global {
  // eslint-disable-next-line no-var
  var __CCB_SANDBOX_RG_PATH__: string | undefined
}

let cachedExtracted: string | null = null

/**
 * Returns the on-disk path of an extracted rg binary, suitable for
 * sandbox-runtime to spawn. Returns null on platforms where the sandbox
 * doesn't need rg (macOS, Windows), or in dev mode (where build.ts
 * stages a vendored rg next to dist/).
 */
export function ensureExtractedRipgrepForSandbox(): string | null {
  if (process.platform !== 'linux') return null
  if (cachedExtracted !== null) return cachedExtracted

  // Dev mode: the vendored on-disk rg is already alongside dist/ via
  // build.ts. sandbox-adapter handles that path on its own; we only
  // care about the standalone-binary case.
  if (!isInBundledMode()) return null

  const embeddedPath = globalThis.__CCB_SANDBOX_RG_PATH__
  if (!embeddedPath) return null

  let bytes: Buffer
  try {
    bytes = readFileSync(embeddedPath)
  } catch (e) {
    logForDebugging(
      `embeddedRgExtractor: readFileSync failed for ${embeddedPath}: ${String(e)}`,
    )
    return null
  }

  const sha = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  const target = join(tmpdir(), `ccb-sandbox-rg-${sha}`)

  if (!existsSync(target)) {
    try {
      mkdirSync(tmpdir(), { recursive: true })
      writeFileSync(target, bytes)
      chmodSync(target, 0o755)
      logForDebugging(
        `embeddedRgExtractor: extracted ${bytes.length} bytes to ${target}`,
      )
    } catch (e) {
      logForDebugging(`embeddedRgExtractor: extract failed: ${String(e)}`)
      return null
    }
  }

  cachedExtracted = target
  return target
}
