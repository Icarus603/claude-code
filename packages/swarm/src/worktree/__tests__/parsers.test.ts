import { describe, expect, test } from 'bun:test'
import { parsePRReference, validateWorktreeSlug } from '../index.js'

describe('parsePRReference — GitHub-style URL', () => {
  test('basic github.com URL', () => {
    expect(parsePRReference('https://github.com/owner/repo/pull/123')).toBe(
      123,
    )
  })

  test('http (not https) accepted', () => {
    expect(parsePRReference('http://github.com/owner/repo/pull/1')).toBe(1)
  })

  test('GHE URL accepted (any host matches)', () => {
    expect(
      parsePRReference('https://ghe.example.com/owner/repo/pull/42'),
    ).toBe(42)
  })

  test('trailing slash accepted', () => {
    expect(
      parsePRReference('https://github.com/owner/repo/pull/123/'),
    ).toBe(123)
  })

  test('query string after URL accepted', () => {
    expect(
      parsePRReference('https://github.com/owner/repo/pull/123?diff=split'),
    ).toBe(123)
  })

  test('fragment after URL accepted', () => {
    expect(
      parsePRReference('https://github.com/owner/repo/pull/123#issue-123'),
    ).toBe(123)
  })

  test('case-insensitive matching', () => {
    // The /i flag is set on the regex.
    expect(
      parsePRReference('HTTPS://GITHUB.COM/owner/repo/PULL/5'),
    ).toBe(5)
  })

  test('multi-digit PR number', () => {
    expect(
      parsePRReference('https://github.com/owner/repo/pull/99999'),
    ).toBe(99999)
  })

  test('owner/repo with hyphens accepted', () => {
    expect(
      parsePRReference('https://github.com/my-org/my-repo/pull/1'),
    ).toBe(1)
  })

  test('owner/repo with dots accepted', () => {
    // The regex is `[^/]+/[^/]+` — anything except slash.
    expect(
      parsePRReference('https://github.com/foo.bar/baz.qux/pull/1'),
    ).toBe(1)
  })
})

describe('parsePRReference — #N format', () => {
  test('#123 accepted', () => {
    expect(parsePRReference('#123')).toBe(123)
  })

  test('#1 accepted', () => {
    expect(parsePRReference('#1')).toBe(1)
  })

  test('multi-digit #N', () => {
    expect(parsePRReference('#99999')).toBe(99999)
  })
})

describe('parsePRReference — rejection cases', () => {
  test('plain number (no #) → null', () => {
    // Anchor: must have '#' prefix or full URL shape.
    expect(parsePRReference('123')).toBeNull()
  })

  test('# without number → null', () => {
    expect(parsePRReference('#')).toBeNull()
  })

  test('# with non-digit → null', () => {
    expect(parsePRReference('#abc')).toBeNull()
  })

  test('# with leading + sign → null (must be plain digits)', () => {
    expect(parsePRReference('#+123')).toBeNull()
  })

  test('GitLab merge request URL → null (different path shape)', () => {
    // GitLab uses /-/merge_requests/N. The regex requires /pull/N.
    expect(
      parsePRReference('https://gitlab.com/owner/repo/-/merge_requests/1'),
    ).toBeNull()
  })

  test('Bitbucket pull-request URL → null', () => {
    expect(
      parsePRReference('https://bitbucket.org/owner/repo/pull-requests/1'),
    ).toBeNull()
  })

  test('URL with extra path segments after PR number → null', () => {
    // The regex is anchored to end (with optional ? or #). Extra paths fail.
    expect(
      parsePRReference('https://github.com/owner/repo/pull/123/files'),
    ).toBeNull()
  })

  test('relative path (not full URL) → null', () => {
    expect(parsePRReference('/owner/repo/pull/123')).toBeNull()
  })

  test('text containing PR URL → null (anchored to start)', () => {
    expect(
      parsePRReference('Check this: https://github.com/owner/repo/pull/123'),
    ).toBeNull()
  })

  test('plain text → null', () => {
    expect(parsePRReference('feature-branch')).toBeNull()
  })

  test('empty string → null', () => {
    expect(parsePRReference('')).toBeNull()
  })

  test('protocol other than http/https → null', () => {
    expect(
      parsePRReference('ftp://github.com/owner/repo/pull/1'),
    ).toBeNull()
  })
})

describe('validateWorktreeSlug — security boundary', () => {
  // CRITICAL: the slug joins into `.claude/worktrees/<slug>` via path.join.
  // Without the validation, '../../../etc/passwd' would escape the
  // worktrees directory, AND an absolute path would discard the prefix.
  // This validator runs synchronously before ANY side effects (git, hooks).

  test('simple alphanumeric slug accepted', () => {
    expect(() => validateWorktreeSlug('feature-foo')).not.toThrow()
  })

  test('underscore + dash + dot allowed', () => {
    expect(() => validateWorktreeSlug('foo_bar.baz-1')).not.toThrow()
  })

  test('digits-only allowed', () => {
    expect(() => validateWorktreeSlug('123')).not.toThrow()
  })

  test('forward-slash nesting allowed (per-segment validation)', () => {
    expect(() => validateWorktreeSlug('user/feature-foo')).not.toThrow()
  })

  test('multi-level nesting allowed', () => {
    expect(() =>
      validateWorktreeSlug('team/user/feature'),
    ).not.toThrow()
  })

  // ─── Path-traversal attempts ────────────────────────────────────────

  test('REJECTS literal "." segment', () => {
    expect(() => validateWorktreeSlug('.')).toThrow(
      /must not contain "\." or "\.\." path segments/,
    )
  })

  test('REJECTS literal ".." segment', () => {
    expect(() => validateWorktreeSlug('..')).toThrow(
      /must not contain "\." or "\.\." path segments/,
    )
  })

  test('REJECTS "../target" path traversal', () => {
    expect(() => validateWorktreeSlug('../target')).toThrow()
  })

  test('REJECTS deeply nested ".." traversal', () => {
    expect(() => validateWorktreeSlug('a/../../etc')).toThrow()
  })

  test('REJECTS "." in middle of path', () => {
    expect(() => validateWorktreeSlug('a/./b')).toThrow()
  })

  // ─── Absolute path attempts ─────────────────────────────────────────

  test('REJECTS leading slash (would create absolute path)', () => {
    // path.join('/.claude/worktrees', '/etc') → '/etc'.
    expect(() => validateWorktreeSlug('/etc/passwd')).toThrow(
      /each "\/"-separated segment must be non-empty/,
    )
  })

  test('REJECTS Windows drive specifier (C:)', () => {
    // Colon is not in the allowlist. C:foo → C:foo segment → fails regex.
    expect(() => validateWorktreeSlug('C:foo')).toThrow(
      /each "\/"-separated segment/,
    )
  })

  test('REJECTS backslash path separator', () => {
    // \ is not in allowlist; the segment 'C\\Users' fails the regex.
    expect(() => validateWorktreeSlug('C\\Users\\foo')).toThrow(
      /each "\/"-separated segment/,
    )
  })

  // ─── Length limit ────────────────────────────────────────────────────

  test('REJECTS slug longer than MAX_WORKTREE_SLUG_LENGTH (64)', () => {
    const long = 'a'.repeat(65)
    expect(() => validateWorktreeSlug(long)).toThrow(
      /must be 64 characters or fewer/,
    )
  })

  test('exactly 64 chars accepted (boundary)', () => {
    const exactly64 = 'a'.repeat(64)
    expect(() => validateWorktreeSlug(exactly64)).not.toThrow()
  })

  test('exactly 65 chars rejected', () => {
    const exactly65 = 'a'.repeat(65)
    expect(() => validateWorktreeSlug(exactly65)).toThrow()
  })

  // ─── Special character attempts ─────────────────────────────────────

  test('REJECTS shell metacharacter $', () => {
    expect(() => validateWorktreeSlug('$(rm)')).toThrow()
  })

  test('REJECTS spaces', () => {
    expect(() => validateWorktreeSlug('foo bar')).toThrow()
  })

  test('REJECTS @ character', () => {
    expect(() => validateWorktreeSlug('foo@bar')).toThrow()
  })

  test('REJECTS unicode (only ASCII allowed)', () => {
    expect(() => validateWorktreeSlug('feature中文')).toThrow()
  })

  test('REJECTS null byte', () => {
    expect(() => validateWorktreeSlug('foo\0bar')).toThrow()
  })

  // ─── Empty segments ──────────────────────────────────────────────────

  test('REJECTS empty string (split produces single empty segment)', () => {
    expect(() => validateWorktreeSlug('')).toThrow(
      /each "\/"-separated segment must be non-empty/,
    )
  })

  test('REJECTS leading slash → empty first segment', () => {
    expect(() => validateWorktreeSlug('/foo')).toThrow()
  })

  test('REJECTS trailing slash → empty last segment', () => {
    expect(() => validateWorktreeSlug('foo/')).toThrow()
  })

  test('REJECTS double-slash → empty middle segment', () => {
    expect(() => validateWorktreeSlug('foo//bar')).toThrow()
  })

  // ─── Boundary: each segment validates independently ──────────────────

  test('valid + invalid segments — fails at the invalid one', () => {
    // 'good/$bad' has good first segment but $ in second.
    expect(() => validateWorktreeSlug('good/$bad')).toThrow()
  })

  test('all segments at length limit — total under cap', () => {
    // Boundary: total length is what matters, not per-segment.
    const slug = 'a'.repeat(31) + '/' + 'b'.repeat(31) // 63 chars
    expect(() => validateWorktreeSlug(slug)).not.toThrow()
  })
})
