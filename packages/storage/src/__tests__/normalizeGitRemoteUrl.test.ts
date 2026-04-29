/**
 * Tests for normalizeGitRemoteUrl — used as the SHA256 input that
 * identifies a repo across SSH/HTTPS clone variants and through the
 * CCR proxy (where the host is encoded in the path).
 *
 * Mistakes here cause two checkouts of the same repo to hash differently
 * (one user gets duplicated session lists) or — worse — two unrelated
 * repos to collide (privacy leak).
 */
import { describe, expect, test } from 'bun:test'
import { normalizeGitRemoteUrl } from '../git.js'

describe('normalizeGitRemoteUrl — SSH format (git@host:owner/repo)', () => {
  test('basic SSH URL with .git suffix', () => {
    expect(normalizeGitRemoteUrl('git@github.com:owner/repo.git')).toBe(
      'github.com/owner/repo',
    )
  })

  test('SSH URL without .git suffix', () => {
    expect(normalizeGitRemoteUrl('git@github.com:owner/repo')).toBe(
      'github.com/owner/repo',
    )
  })

  test('SSH with deep path (/group/subgroup/repo)', () => {
    expect(normalizeGitRemoteUrl('git@gitlab.com:group/subgroup/repo.git'))
      .toBe('gitlab.com/group/subgroup/repo')
  })

  test('SSH lowercases host AND path', () => {
    expect(normalizeGitRemoteUrl('git@GITHUB.COM:OWNER/Repo.git')).toBe(
      'github.com/owner/repo',
    )
  })
})

describe('normalizeGitRemoteUrl — HTTPS/SSH URL format', () => {
  test('https URL with .git', () => {
    expect(normalizeGitRemoteUrl('https://github.com/owner/repo.git')).toBe(
      'github.com/owner/repo',
    )
  })

  test('https URL without .git', () => {
    expect(normalizeGitRemoteUrl('https://github.com/owner/repo')).toBe(
      'github.com/owner/repo',
    )
  })

  test('http URL (insecure) is also accepted', () => {
    expect(normalizeGitRemoteUrl('http://gitea.example.com/user/proj')).toBe(
      'gitea.example.com/user/proj',
    )
  })

  test('https URL with userinfo (token@host) strips the userinfo', () => {
    expect(
      normalizeGitRemoteUrl('https://x-access-token:abc@github.com/owner/repo'),
    ).toBe('github.com/owner/repo')
  })

  test('ssh:// URL is accepted', () => {
    expect(normalizeGitRemoteUrl('ssh://git@github.com/owner/repo')).toBe(
      'github.com/owner/repo',
    )
  })

  test('lowercases everything', () => {
    expect(normalizeGitRemoteUrl('https://GitHub.com/Owner/Repo.git')).toBe(
      'github.com/owner/repo',
    )
  })
})

describe('normalizeGitRemoteUrl — CCR proxy URLs', () => {
  test('legacy proxy format (no host in path) → assumes github.com', () => {
    // http://...@127.0.0.1:PORT/git/owner/repo
    expect(
      normalizeGitRemoteUrl(
        'http://local_proxy@127.0.0.1:16583/git/owner/repo',
      ),
    ).toBe('github.com/owner/repo')
  })

  test('GHE proxy format (host encoded in path) → uses encoded host', () => {
    // First path segment with a dot is treated as hostname.
    expect(
      normalizeGitRemoteUrl(
        'http://proxy@127.0.0.1:9999/git/ghe.host.com/owner/repo',
      ),
    ).toBe('ghe.host.com/owner/repo')
  })

  test('proxy on localhost (not 127.0.0.1) also strips /git/ prefix', () => {
    expect(
      normalizeGitRemoteUrl('http://localhost:16583/git/owner/repo'),
    ).toBe('github.com/owner/repo')
  })

  test('proxy with .git suffix on the repo name', () => {
    expect(
      normalizeGitRemoteUrl('http://127.0.0.1:8080/git/owner/repo.git'),
    ).toBe('github.com/owner/repo')
  })

  test('non-proxy 127.0.0.1 URL (no /git/ prefix) → kept as-is', () => {
    // Without /git/, this isn't a proxy URL — treat host normally.
    expect(normalizeGitRemoteUrl('http://127.0.0.1:8080/owner/repo')).toBe(
      '127.0.0.1:8080/owner/repo',
    )
  })

  test('proxy with two-segment GHE-like path → assumes github.com (only owner/repo)', () => {
    // 2 segments after /git/ → legacy format → github.com prefix.
    expect(
      normalizeGitRemoteUrl('http://127.0.0.1:8080/git/owner/repo'),
    ).toBe('github.com/owner/repo')
  })

  test('proxy with first-segment-no-dot (3 segments) → still github.com', () => {
    // Documented: the dot heuristic for "is this a hostname". Without a
    // dot, the first segment is treated as the org name.
    expect(
      normalizeGitRemoteUrl('http://127.0.0.1:8080/git/group/subgroup/repo'),
    ).toBe('github.com/group/subgroup/repo')
  })
})

describe('normalizeGitRemoteUrl — invalid / edge inputs', () => {
  test('empty string → null', () => {
    expect(normalizeGitRemoteUrl('')).toBeNull()
  })

  test('whitespace only → null', () => {
    expect(normalizeGitRemoteUrl('   \t  \n')).toBeNull()
  })

  test('plain text (not a URL) → null', () => {
    expect(normalizeGitRemoteUrl('not-a-url')).toBeNull()
  })

  test('ftp:// URL is NOT recognized → null', () => {
    expect(normalizeGitRemoteUrl('ftp://example.com/repo')).toBeNull()
  })

  test('git:// URL is NOT recognized → null', () => {
    // The git:// protocol scheme isn't in the regex (only http/https/ssh).
    expect(normalizeGitRemoteUrl('git://github.com/owner/repo')).toBeNull()
  })

  test('SSH form with empty owner → null (regex requires non-empty)', () => {
    expect(normalizeGitRemoteUrl('git@github.com:')).toBeNull()
  })

  test('leading/trailing whitespace is trimmed', () => {
    expect(
      normalizeGitRemoteUrl('  https://github.com/owner/repo.git  '),
    ).toBe('github.com/owner/repo')
  })
})

describe('normalizeGitRemoteUrl — case sensitivity invariant', () => {
  test('SSH and HTTPS forms of same repo normalize identically', () => {
    expect(normalizeGitRemoteUrl('git@github.com:Owner/Repo.git')).toBe(
      normalizeGitRemoteUrl('https://github.com/Owner/Repo.git'),
    )
  })

  test('proxy and direct forms of same repo normalize identically', () => {
    expect(
      normalizeGitRemoteUrl('http://proxy@127.0.0.1:8080/git/owner/repo'),
    ).toBe(normalizeGitRemoteUrl('https://github.com/owner/repo.git'))
  })
})

describe('normalizeGitRemoteUrl — IPv6 host literals', () => {
  test('IPv6 ssh://[::1]:22/owner/repo → [::1]/owner/repo', () => {
    expect(normalizeGitRemoteUrl('ssh://git@[::1]:22/owner/repo')).toBe(
      '[::1]/owner/repo',
    )
  })

  test('IPv6 routable host with port → port stripped', () => {
    expect(
      normalizeGitRemoteUrl('http://[2001:db8::1]:8443/owner/repo'),
    ).toBe('[2001:db8::1]/owner/repo')
  })

  test('IPv6 with and without port are equivalent (same hash)', () => {
    expect(
      normalizeGitRemoteUrl('http://[2001:db8::1]:8443/owner/repo'),
    ).toBe(normalizeGitRemoteUrl('http://[2001:db8::1]/owner/repo'))
  })

  test('IPv6 brackets preserved in normalized output', () => {
    // Without bracket-aware splitting, host.split(':')[0] would strip the
    // closing bracket and produce "[" as the host. The fix uses ']:' as
    // the separator.
    const r = normalizeGitRemoteUrl('http://[2001:db8::1]/owner/repo')
    expect(r).toMatch(/^\[2001:db8::1\]\//)
  })
})

describe('normalizeGitRemoteUrl — URL suffix stripping', () => {
  test('trailing slash is stripped', () => {
    expect(normalizeGitRemoteUrl('https://github.com/owner/repo/')).toBe(
      'github.com/owner/repo',
    )
  })

  test('multiple trailing slashes are stripped', () => {
    expect(normalizeGitRemoteUrl('https://github.com/owner/repo///')).toBe(
      'github.com/owner/repo',
    )
  })

  test('?query suffix is stripped', () => {
    expect(normalizeGitRemoteUrl('https://github.com/owner/repo?ref=main'))
      .toBe('github.com/owner/repo')
  })

  test('#hash suffix is stripped', () => {
    expect(normalizeGitRemoteUrl('https://github.com/owner/repo#branch'))
      .toBe('github.com/owner/repo')
  })

  test('combination of suffixes is fully stripped', () => {
    expect(
      normalizeGitRemoteUrl('https://github.com/owner/repo.git/?ref=main#x'),
    ).toBe('github.com/owner/repo')
  })

  test('all suffix forms hash identically to canonical', () => {
    const canonical = 'github.com/owner/repo'
    expect(normalizeGitRemoteUrl('https://github.com/owner/repo')).toBe(canonical)
    expect(normalizeGitRemoteUrl('https://github.com/owner/repo/')).toBe(canonical)
    expect(normalizeGitRemoteUrl('https://github.com/owner/repo?x=y')).toBe(canonical)
    expect(normalizeGitRemoteUrl('https://github.com/owner/repo#x')).toBe(canonical)
    expect(normalizeGitRemoteUrl('https://github.com/owner/repo.git/')).toBe(canonical)
  })
})

describe('normalizeGitRemoteUrl — port-stripping (regression)', () => {
  test('explicit port on non-localhost host is stripped (SSH 22)', () => {
    // Real-world bug: git@github.com:owner/repo and
    // ssh://git@github.com:22/owner/repo are the same clone target. They
    // MUST hash identically, otherwise the same checkout shows up twice
    // in --resume lists.
    expect(normalizeGitRemoteUrl('ssh://git@github.com:22/owner/repo.git'))
      .toBe('github.com/owner/repo')
  })

  test('explicit HTTPS port (443) is stripped', () => {
    expect(normalizeGitRemoteUrl('https://github.com:443/owner/repo.git'))
      .toBe('github.com/owner/repo')
  })

  test('non-standard port on non-localhost is stripped too', () => {
    // The function strips the entire ":port" suffix, regardless of value.
    // This is correct: the repo identity is host+path, not the connection
    // port the user happens to be using.
    expect(normalizeGitRemoteUrl('ssh://git@github.com:2222/owner/repo'))
      .toBe('github.com/owner/repo')
  })

  test('all 4 forms (SCP, ssh:// no port, ssh:// :22, https :443) match', () => {
    const expected = 'github.com/owner/repo'
    expect(normalizeGitRemoteUrl('git@github.com:owner/repo.git')).toBe(expected)
    expect(normalizeGitRemoteUrl('ssh://git@github.com/owner/repo.git')).toBe(expected)
    expect(normalizeGitRemoteUrl('ssh://git@github.com:22/owner/repo.git')).toBe(expected)
    expect(normalizeGitRemoteUrl('https://github.com:443/owner/repo.git')).toBe(expected)
  })

  test('localhost ports are KEPT (CCR proxy uses port to distinguish daemons)', () => {
    // Documented: localhost ports ARE distinguishing — different ports
    // are different proxy daemons, possibly serving different repos.
    expect(normalizeGitRemoteUrl('http://127.0.0.1:8080/owner/repo')).toBe(
      '127.0.0.1:8080/owner/repo',
    )
    expect(normalizeGitRemoteUrl('http://127.0.0.1:9999/owner/repo')).toBe(
      '127.0.0.1:9999/owner/repo',
    )
  })
})
