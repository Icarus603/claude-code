// Leaf module: pure git-remote URL parser. Extracted from detectRepository.ts
// to break the storage/git ↔ storage/detectRepository cycle (git uses
// parseGitRemote in getGithubRepo via dynamic import; detectRepository
// imports getRemoteUrl from git statically).

export type ParsedRepository = {
  host: string
  owner: string
  name: string
}

/**
 * Parses a git remote URL into host, owner, and name components.
 * Supports: SSH (git@host:owner/repo.git), URL (https/ssh/git://host/owner/repo[.git]).
 */
export function parseGitRemote(input: string): ParsedRepository | null {
  const trimmed = input.trim()

  // SSH format: git@host:owner/repo.git
  const sshMatch = trimmed.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (sshMatch?.[1] && sshMatch[2] && sshMatch[3]) {
    if (!looksLikeRealHostname(sshMatch[1])) return null
    return {
      host: sshMatch[1],
      owner: sshMatch[2],
      name: sshMatch[3],
    }
  }

  // URL format: https://host/owner/repo.git, ssh://git@host/owner/repo, git://host/owner/repo
  const urlMatch = trimmed.match(
    /^(https?|ssh|git):\/\/(?:[^@]+@)?([^/:]+(?::\d+)?)\/([^/]+)\/([^/]+?)(?:\.git)?$/,
  )
  if (urlMatch?.[1] && urlMatch[2] && urlMatch[3] && urlMatch[4]) {
    const protocol = urlMatch[1]
    const hostWithPort = urlMatch[2]
    const hostWithoutPort = hostWithPort.split(':')[0] ?? ''
    if (!looksLikeRealHostname(hostWithoutPort)) return null
    const host =
      protocol === 'https' || protocol === 'http'
        ? hostWithPort
        : hostWithoutPort
    return {
      host,
      owner: urlMatch[3],
      name: urlMatch[4],
    }
  }

  return null
}

/**
 * Real TLDs are purely alphabetic; SSH aliases like "github.com-work" have a
 * last segment "com-work" which contains a hyphen.
 */
function looksLikeRealHostname(host: string): boolean {
  if (!host.includes('.')) return false
  const lastSegment = host.split('.').pop()
  if (!lastSegment) return false
  return /^[a-zA-Z]+$/.test(lastSegment)
}
