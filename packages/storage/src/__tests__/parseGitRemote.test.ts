import { describe, expect, test } from 'bun:test'
import { parseGitRemote } from '../parseGitRemote.js'

describe('parseGitRemote — SSH format (git@host:owner/repo)', () => {
  test('basic SSH URL with .git suffix', () => {
    expect(parseGitRemote('git@github.com:owner/repo.git')).toEqual({
      host: 'github.com',
      owner: 'owner',
      name: 'repo',
    })
  })

  test('SSH URL without .git suffix', () => {
    expect(parseGitRemote('git@github.com:owner/repo')).toEqual({
      host: 'github.com',
      owner: 'owner',
      name: 'repo',
    })
  })

  test('GitLab SSH', () => {
    expect(parseGitRemote('git@gitlab.com:group/project.git')).toEqual({
      host: 'gitlab.com',
      owner: 'group',
      name: 'project',
    })
  })

  test('Bitbucket SSH', () => {
    expect(parseGitRemote('git@bitbucket.org:team/repo.git')).toEqual({
      host: 'bitbucket.org',
      owner: 'team',
      name: 'repo',
    })
  })

  test('SSH URL with hyphenated owner/repo', () => {
    expect(parseGitRemote('git@github.com:my-org/my-repo.git')).toEqual({
      host: 'github.com',
      owner: 'my-org',
      name: 'my-repo',
    })
  })

  test('rejects SSH alias hostnames (e.g., "github.com-work")', () => {
    // Critical contract: SSH aliases like "github.com-work" used in
    // ~/.ssh/config look like real hosts but are NOT — looksLikeRealHostname
    // requires the last DNS segment to be purely alphabetic. "com-work"
    // contains a hyphen → rejected. Without this, GitHub repo discovery
    // would mis-route to the alias name as the host string.
    expect(parseGitRemote('git@github.com-work:owner/repo.git')).toBeNull()
  })

  test('rejects bare hostname (no dot)', () => {
    expect(parseGitRemote('git@localhost:owner/repo.git')).toBeNull()
  })

  test('rejects digit-only TLD', () => {
    // 192.168.1.1 — last segment is "1" (digits), which fails alpha-only.
    expect(parseGitRemote('git@192.168.1.1:owner/repo.git')).toBeNull()
  })

  test('preserves trailing whitespace via trim', () => {
    expect(parseGitRemote('  git@github.com:owner/repo.git  ')).toEqual({
      host: 'github.com',
      owner: 'owner',
      name: 'repo',
    })
  })
})

describe('parseGitRemote — HTTPS format', () => {
  test('basic HTTPS URL with .git', () => {
    expect(parseGitRemote('https://github.com/owner/repo.git')).toEqual({
      host: 'github.com',
      owner: 'owner',
      name: 'repo',
    })
  })

  test('HTTPS URL without .git', () => {
    expect(parseGitRemote('https://github.com/owner/repo')).toEqual({
      host: 'github.com',
      owner: 'owner',
      name: 'repo',
    })
  })

  test('HTTP URL (not just HTTPS)', () => {
    expect(parseGitRemote('http://gitea.example.com/owner/repo.git')).toEqual({
      host: 'gitea.example.com',
      owner: 'owner',
      name: 'repo',
    })
  })

  test('HTTPS with embedded credentials (user@host)', () => {
    expect(
      parseGitRemote('https://user:pass@github.com/owner/repo.git'),
    ).toEqual({
      host: 'github.com',
      owner: 'owner',
      name: 'repo',
    })
  })

  test('HTTPS with port — port preserved in host (https/http only)', () => {
    // Critical: HTTPS/HTTP keep port in host string (e.g., "ent.example.com:8443")
    // because the host component naturally includes :port for HTTP routing.
    // SSH/git protocols strip the port (different convention).
    expect(parseGitRemote('https://example.com:8443/owner/repo.git')).toEqual({
      host: 'example.com:8443',
      owner: 'owner',
      name: 'repo',
    })
  })
})

describe('parseGitRemote — git:// format', () => {
  test('git:// URL', () => {
    expect(parseGitRemote('git://github.com/owner/repo.git')).toEqual({
      host: 'github.com',
      owner: 'owner',
      name: 'repo',
    })
  })

  test('git:// strips port from host (different convention vs https)', () => {
    // For git:// protocol, port is stripped from host. Documents this
    // asymmetry vs https where port stays attached.
    expect(parseGitRemote('git://example.com:9418/owner/repo.git')).toEqual({
      host: 'example.com',
      owner: 'owner',
      name: 'repo',
    })
  })
})

describe('parseGitRemote — ssh:// format', () => {
  test('ssh:// with embedded user', () => {
    expect(parseGitRemote('ssh://git@github.com/owner/repo.git')).toEqual({
      host: 'github.com',
      owner: 'owner',
      name: 'repo',
    })
  })

  test('ssh:// strips port from host', () => {
    expect(parseGitRemote('ssh://git@example.com:22/owner/repo.git')).toEqual({
      host: 'example.com',
      owner: 'owner',
      name: 'repo',
    })
  })
})

describe('parseGitRemote — invalid inputs', () => {
  test('empty string returns null', () => {
    expect(parseGitRemote('')).toBeNull()
  })

  test('whitespace-only returns null', () => {
    expect(parseGitRemote('   ')).toBeNull()
  })

  test('plain text returns null', () => {
    expect(parseGitRemote('not a git url')).toBeNull()
  })

  test('https without owner/repo path returns null', () => {
    expect(parseGitRemote('https://github.com')).toBeNull()
  })

  test('https with only owner (no repo) returns null', () => {
    expect(parseGitRemote('https://github.com/owner')).toBeNull()
  })

  test('https with too many path segments returns null', () => {
    // The regex matches ([^/]+)\/([^/]+) — exactly two segments after host.
    // /owner/repo/sub would have a trailing /sub that doesn't fit.
    expect(
      parseGitRemote('https://github.com/owner/repo/extra'),
    ).toBeNull()
  })

  test('SSH with extra colons absorbs into owner field (regex permissive)', () => {
    // Documents the actual behavior: regex `[^/]+` allows colons inside
    // the owner segment. `git@github.com:owner:extra/repo.git` matches
    // with owner='owner:extra'. A future tightening could reject this,
    // but the current contract is permissive.
    expect(parseGitRemote('git@github.com:owner:extra/repo.git')).toEqual({
      host: 'github.com',
      owner: 'owner:extra',
      name: 'repo',
    })
  })

  test('unrecognized protocol returns null', () => {
    expect(
      parseGitRemote('ftp://github.com/owner/repo.git'),
    ).toBeNull()
  })

  test('gibberish with @ does not match SSH form', () => {
    expect(parseGitRemote('xxx@yyy.zzz')).toBeNull()
  })
})

describe('parseGitRemote — repo name suffix handling', () => {
  test('strips ONLY trailing .git, not internal .git', () => {
    // Repo names with internal dots/.git need careful regex handling.
    // The non-greedy +?(?:\.git)? captures the longest non-.git portion.
    expect(parseGitRemote('git@github.com:owner/my.repo.git')).toEqual({
      host: 'github.com',
      owner: 'owner',
      name: 'my.repo',
    })
  })

  test('repo name with no extension', () => {
    expect(parseGitRemote('git@github.com:owner/repo-name')).toEqual({
      host: 'github.com',
      owner: 'owner',
      name: 'repo-name',
    })
  })

  test('repo name with dots (no .git suffix)', () => {
    expect(parseGitRemote('git@github.com:owner/my.dotted.repo')).toEqual({
      host: 'github.com',
      owner: 'owner',
      name: 'my.dotted.repo',
    })
  })
})
