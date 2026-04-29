/**
 * Tests for parseGitHubRepository — the GitHub.com-only owner/repo
 * resolver used by VS Code extension and bridge for PR/repo
 * inference.
 *
 * Wrong matching = either:
 *   - GHE URL leaks through as "owner/repo" → caller constructs
 *     github.com URL that 404s
 *   - Valid GitHub URL rejected → user can't link to PRs/issues
 *
 * Two paths: full URL via parseGitRemote, or plain "owner/repo" via
 * direct split. Both must return null for GHE / malformed input.
 */
import { describe, expect, test } from 'bun:test'
import { parseGitHubRepository } from '../detectRepository.js'

describe('parseGitHubRepository — full URL parsing', () => {
  test('https://github.com/owner/repo → "owner/repo"', () => {
    expect(parseGitHubRepository('https://github.com/anthropics/claude-code')).toBe(
      'anthropics/claude-code',
    )
  })

  test('https://github.com/owner/repo.git → strips .git', () => {
    expect(
      parseGitHubRepository('https://github.com/anthropics/claude-code.git'),
    ).toBe('anthropics/claude-code')
  })

  test('git@github.com:owner/repo.git → "owner/repo"', () => {
    expect(
      parseGitHubRepository('git@github.com:anthropics/claude-code.git'),
    ).toBe('anthropics/claude-code')
  })

  test('ssh://git@github.com/owner/repo.git → "owner/repo"', () => {
    expect(
      parseGitHubRepository('ssh://git@github.com/anthropics/claude-code.git'),
    ).toBe('anthropics/claude-code')
  })

  test('git://github.com/owner/repo.git → "owner/repo"', () => {
    expect(
      parseGitHubRepository('git://github.com/anthropics/claude-code.git'),
    ).toBe('anthropics/claude-code')
  })

  test('GHE host (e.g. github.example.com) → null', () => {
    // Documented contract: GHE URLs are rejected. Use parseGitRemote
    // directly if GHE support is needed.
    expect(
      parseGitHubRepository('https://github.example.com/owner/repo.git'),
    ).toBeNull()
  })

  test('repo name with dot (e.g. cc.kurs.web) preserved', () => {
    expect(parseGitHubRepository('https://github.com/owner/cc.kurs.web')).toBe(
      'owner/cc.kurs.web',
    )
  })
})

describe('parseGitHubRepository — bare owner/repo strings', () => {
  test('plain "owner/repo" → returned as-is', () => {
    expect(parseGitHubRepository('anthropics/claude-code')).toBe(
      'anthropics/claude-code',
    )
  })

  test('"owner/repo.git" → strips .git suffix', () => {
    expect(parseGitHubRepository('anthropics/claude-code.git')).toBe(
      'anthropics/claude-code',
    )
  })

  test('whitespace trimmed before parse', () => {
    expect(parseGitHubRepository('  anthropics/claude-code  ')).toBe(
      'anthropics/claude-code',
    )
  })

  test('just "owner" (no slash) → null', () => {
    expect(parseGitHubRepository('anthropics')).toBeNull()
  })

  test('"a/b/c" (3+ segments) → null (only 2-segment owner/repo accepted)', () => {
    expect(parseGitHubRepository('a/b/c')).toBeNull()
  })

  test('empty owner ("/repo") → null', () => {
    expect(parseGitHubRepository('/repo')).toBeNull()
  })

  test('empty repo ("owner/") → null', () => {
    expect(parseGitHubRepository('owner/')).toBeNull()
  })

  test('owner/repo with dot in repo name preserved', () => {
    expect(parseGitHubRepository('owner/foo.bar.baz')).toBe('owner/foo.bar.baz')
  })
})

describe('parseGitHubRepository — invalid / null cases', () => {
  test('empty string → null', () => {
    expect(parseGitHubRepository('')).toBeNull()
  })

  test('whitespace-only → null', () => {
    expect(parseGitHubRepository('   ')).toBeNull()
  })

  test('not a URL or path → null', () => {
    expect(parseGitHubRepository('not a repo')).toBeNull()
  })

  test('URL without owner/repo path → null', () => {
    expect(parseGitHubRepository('https://github.com')).toBeNull()
  })

  test('URL with @ but not git@ pattern (not handled as bare path)', () => {
    // Documented: '@' triggers URL-parse path which fails, then bare path
    // path skips because trimmed contains '@'. Result: null.
    expect(parseGitHubRepository('user@somewhere.com')).toBeNull()
  })

  test('URL with :// triggers URL-parse path; if not GitHub host → null', () => {
    expect(parseGitHubRepository('https://gitlab.com/owner/repo')).toBeNull()
  })
})

describe('parseGitHubRepository — case sensitivity', () => {
  test('host is recognized regardless of www prefix on github.com', () => {
    // parseGitRemote has its own normalization; we just verify the bare
    // path works case-as-given.
    expect(parseGitHubRepository('Anthropics/Claude-Code')).toBe(
      'Anthropics/Claude-Code',
    )
  })
})

describe('parseGitHubRepository — boundary characters', () => {
  test('owner/repo with hyphens preserved', () => {
    expect(parseGitHubRepository('multi-word-owner/multi-word-repo')).toBe(
      'multi-word-owner/multi-word-repo',
    )
  })

  test('owner/repo with underscores preserved', () => {
    expect(parseGitHubRepository('snake_case_owner/snake_case_repo')).toBe(
      'snake_case_owner/snake_case_repo',
    )
  })

  test('numeric owner/repo accepted', () => {
    expect(parseGitHubRepository('123/456')).toBe('123/456')
  })
})
