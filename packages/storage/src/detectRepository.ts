import { getCwd } from '@claude-code/app-host/bootstrap/cwd.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { getRemoteUrl } from './git.js'
import { parseGitRemote, type ParsedRepository } from './parseGitRemote.js'

export { parseGitRemote, type ParsedRepository }

const repositoryWithHostCache = new Map<string, ParsedRepository | null>()

export function clearRepositoryCaches(): void {
  repositoryWithHostCache.clear()
}

export async function detectCurrentRepository(): Promise<string | null> {
  const result = await detectCurrentRepositoryWithHost()
  if (!result) return null
  // Only return results for github.com to avoid breaking downstream consumers
  // that assume the result is a github.com repository.
  // Use detectCurrentRepositoryWithHost() for GHE support.
  if (result.host !== 'github.com') return null
  return `${result.owner}/${result.name}`
}

/**
 * Like detectCurrentRepository, but also returns the host (e.g. "github.com"
 * or a GHE hostname). Callers that need to construct URLs against a specific
 * GitHub host should use this variant.
 */
export async function detectCurrentRepositoryWithHost(): Promise<ParsedRepository | null> {
  const cwd = getCwd()

  if (repositoryWithHostCache.has(cwd)) {
    return repositoryWithHostCache.get(cwd) ?? null
  }

  try {
    const remoteUrl = await getRemoteUrl()
    logForDebugging(`Git remote URL: ${remoteUrl}`)
    if (!remoteUrl) {
      logForDebugging('No git remote URL found')
      repositoryWithHostCache.set(cwd, null)
      return null
    }

    const parsed = parseGitRemote(remoteUrl)
    logForDebugging(
      `Parsed repository: ${parsed ? `${parsed.host}/${parsed.owner}/${parsed.name}` : null} from URL: ${remoteUrl}`,
    )
    repositoryWithHostCache.set(cwd, parsed)
    return parsed
  } catch (error) {
    logForDebugging(`Error detecting repository: ${error}`)
    repositoryWithHostCache.set(cwd, null)
    return null
  }
}

/**
 * Synchronously returns the cached github.com repository for the current cwd
 * as "owner/name", or null if it hasn't been resolved yet or the host is not
 * github.com. Call detectCurrentRepository() first to populate the cache.
 *
 * Callers construct github.com URLs, so GHE hosts are filtered out here.
 */
export function getCachedRepository(): string | null {
  const parsed = repositoryWithHostCache.get(getCwd())
  if (!parsed || parsed.host !== 'github.com') return null
  return `${parsed.owner}/${parsed.name}`
}

/**
 * Parses a git remote URL into host, owner, and name components.
 * Accepts any host (github.com, GHE instances, etc.).
 *
 * Supports:
 *   https://host/owner/repo.git
 *   git@host:owner/repo.git
 *   ssh://git@host/owner/repo.git
 *   git://host/owner/repo.git
 *   https://host/owner/repo (no .git)
 *
 * Note: repo names can contain dots (e.g., cc.kurs.web)
 */
/**
 * Parses a git remote URL or "owner/repo" string and returns "owner/repo".
 * Only returns results for github.com hosts — GHE URLs return null.
 * Use parseGitRemote() for GHE support.
 * Also accepts plain "owner/repo" strings for backward compatibility.
 */
export function parseGitHubRepository(input: string): string | null {
  const trimmed = input.trim()

  // Try parsing as a full remote URL first.
  // Only return results for github.com hosts — existing callers (VS Code extension,
  // bridge) assume this function is GitHub.com-specific. Use parseGitRemote() directly
  // for GHE support.
  const parsed = parseGitRemote(trimmed)
  if (parsed) {
    if (parsed.host !== 'github.com') return null
    return `${parsed.owner}/${parsed.name}`
  }

  // If no URL pattern matched, check if it's already in owner/repo format
  if (
    !trimmed.includes('://') &&
    !trimmed.includes('@') &&
    trimmed.includes('/')
  ) {
    const parts = trimmed.split('/')
    if (parts.length === 2 && parts[0] && parts[1]) {
      // Remove .git extension if present
      const repo = parts[1].replace(/\.git$/, '')
      return `${parts[0]}/${repo}`
    }
  }

  logForDebugging(`Could not parse repository from: ${trimmed}`)
  return null
}

// looksLikeRealHostname moved to ./parseGitRemote.ts (private helper).
