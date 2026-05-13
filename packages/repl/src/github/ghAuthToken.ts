/**
 * gh auth token reader — ported from ant v2.1.128 BZ7 (3671.js).
 *
 * Runs `gh auth token --hostname <host>` and caches the result per host
 * for the lifetime of the process. Used by `ghPrStatusViaRest` so that
 * each PR-status poll doesn't re-spawn gh.
 *
 * Honours the same env-var precedence ant does:
 *   - `GH_TOKEN` / `GITHUB_TOKEN` for github.com
 *   - `GH_ENTERPRISE_TOKEN` / `GITHUB_ENTERPRISE_TOKEN` for `GH_HOST`
 *
 * Returns `null` (not an empty string) when no token is reachable, so
 * callers can distinguish "no auth" from "empty auth".
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const TOKEN_CACHE = new Map<string, string | null>()
const GH_TIMEOUT_MS = 5000

function getEnvTokenForHost(host: string): string | undefined {
  const isDefault = host === 'github.com'
  if (isDefault) {
    return process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? undefined
  }
  return (
    process.env.GH_ENTERPRISE_TOKEN ??
    process.env.GITHUB_ENTERPRISE_TOKEN ??
    undefined
  )
}

export async function getGhAuthToken(
  host = 'github.com',
): Promise<string | null> {
  if (TOKEN_CACHE.has(host)) {
    return TOKEN_CACHE.get(host) ?? null
  }
  const env = getEnvTokenForHost(host)
  if (env && env.length > 0) {
    TOKEN_CACHE.set(host, env)
    return env
  }
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['auth', 'token', '--hostname', host],
      { timeout: GH_TIMEOUT_MS, maxBuffer: 64 * 1024 },
    )
    const token = (stdout ?? '').toString().trim()
    if (token.length === 0) {
      TOKEN_CACHE.set(host, null)
      return null
    }
    TOKEN_CACHE.set(host, token)
    return token
  } catch {
    TOKEN_CACHE.set(host, null)
    return null
  }
}

// (no test-reset seam exported until a test consumes it; cache is module-private)
