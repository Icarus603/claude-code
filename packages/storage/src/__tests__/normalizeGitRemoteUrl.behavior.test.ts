import { describe, expect, test } from 'bun:test'

import { normalizeGitRemoteUrl } from '../git.ts'

/**
 * Pin git remote URL normalization. This produces the stable repo
 * identity used in:
 *   - getRepoRemoteHash (SHA256 → first 16 chars for analytics)
 *   - Cross-machine session matching (same repo cloned via SSH vs HTTPS)
 *
 * Wrong normalization → same repo treated as different, breaking:
 *   - Session resume across SSH/HTTPS clone forms
 *   - Per-repo settings (CLAUDE.md hierarchy lookup keyed on repo id)
 *   - Analytics dedup (same repo counted multiple times)
 */
describe('normalizeGitRemoteUrl (repo identity derivation)', () => {
  test('SSH format → host/owner/repo (lowercase)', () => {
    expect(normalizeGitRemoteUrl('git@github.com:Anthropic/claude-code.git')).toBe(
      'github.com/anthropic/claude-code',
    )
  })

  test('SSH without .git suffix', () => {
    expect(normalizeGitRemoteUrl('git@github.com:owner/repo')).toBe(
      'github.com/owner/repo',
    )
  })

  test('HTTPS → host/owner/repo (lowercase, .git stripped)', () => {
    expect(normalizeGitRemoteUrl('https://github.com/Anthropic/claude-code.git')).toBe(
      'github.com/anthropic/claude-code',
    )
  })

  test('HTTPS with auth in URL → strips user:pass@', () => {
    expect(normalizeGitRemoteUrl('https://user:token@github.com/owner/repo.git')).toBe(
      'github.com/owner/repo',
    )
  })

  test('CCR proxy legacy form (github.com assumed)', () => {
    // http://proxy@127.0.0.1:16583/git/owner/repo → github.com/owner/repo
    expect(normalizeGitRemoteUrl('http://localproxy@127.0.0.1:16583/git/owner/repo')).toBe(
      'github.com/owner/repo',
    )
  })

  test('CCR proxy GHE form (host encoded in path)', () => {
    // 3 segments with dot in first → host/owner/repo (GHE format)
    expect(
      normalizeGitRemoteUrl('http://proxy@127.0.0.1:16583/git/ghe.example.com/owner/repo'),
    ).toBe('ghe.example.com/owner/repo')
  })

  test('SSH and HTTPS forms of same repo produce IDENTICAL output', () => {
    // Critical for cross-machine session matching.
    const ssh = normalizeGitRemoteUrl('git@github.com:owner/repo.git')
    const https = normalizeGitRemoteUrl('https://github.com/owner/repo.git')
    expect(ssh).toBe(https)
  })

  test('strips ?ref=foo query string (doesn\'t affect repo identity)', () => {
    expect(normalizeGitRemoteUrl('https://github.com/owner/repo.git?ref=main')).toBe(
      'github.com/owner/repo',
    )
  })

  test('strips #fragment', () => {
    expect(normalizeGitRemoteUrl('https://github.com/owner/repo.git#branch')).toBe(
      'github.com/owner/repo',
    )
  })

  test('strips trailing slash', () => {
    expect(normalizeGitRemoteUrl('https://github.com/owner/repo/')).toBe(
      'github.com/owner/repo',
    )
  })

  test('strips port on non-localhost URLs (so same repo on http vs https hashes same)', () => {
    // Custom git server on a port should still match across schemes.
    expect(normalizeGitRemoteUrl('https://git.example.com:8443/owner/repo.git')).toBe(
      'git.example.com/owner/repo',
    )
  })

  test('keeps port on LOCALHOST (multiple local git servers may differ by port)', () => {
    // Local proxy is distinct per-port; don't conflate.
    expect(normalizeGitRemoteUrl('http://localhost:8080/owner/repo')).toBe(
      'localhost:8080/owner/repo',
    )
  })

  test('case-insensitive (lowercases for stable hash)', () => {
    expect(normalizeGitRemoteUrl('https://GitHub.com/OWNER/REPO.git')).toBe(
      'github.com/owner/repo',
    )
  })

  test('empty/whitespace → null', () => {
    expect(normalizeGitRemoteUrl('')).toBe(null)
    expect(normalizeGitRemoteUrl('   ')).toBe(null)
  })

  test('unrecognized format → null (not throw)', () => {
    // Defensive: a garbage remote URL shouldn't crash the session-resume path.
    expect(normalizeGitRemoteUrl('not-a-url')).toBe(null)
    expect(normalizeGitRemoteUrl('file:///local/repo')).toBe(null)
  })

  test('IPv6 hostnames preserved with brackets when port stripped', () => {
    // Pin the IPv6 regex (the tricky case). Without it, `[::1]:port` would
    // strip the bracketed address as if it were a port.
    expect(normalizeGitRemoteUrl('https://[2001:db8::1]:8443/owner/repo')).toBe(
      '[2001:db8::1]/owner/repo',
    )
  })
})
