/**
 * Tests for generateTmuxSessionName + worktreeBranchName — pure
 * naming helpers used by the worktree subsystem.
 *
 * Wrong session naming = teammate panes collide in tmux (multiple
 * sessions sharing the same name → tmux refuses to create or
 * silently joins).
 *
 * Wrong branch naming = D/F conflict (git refs can't be both a
 * file and a directory at the same path), worktree creation fails.
 */
import { describe, expect, test } from 'bun:test'
import {
  generateTmuxSessionName,
  worktreeBranchName,
} from '../index.js'

describe('generateTmuxSessionName', () => {
  test('basic: repo + branch joined with _', () => {
    expect(generateTmuxSessionName('/path/to/myrepo', 'feature')).toBe(
      'myrepo_feature',
    )
  })

  test('uses basename, not full path', () => {
    expect(generateTmuxSessionName('/Users/alice/code/repo', 'main')).toBe(
      'repo_main',
    )
  })

  test('slashes in branch replaced with _', () => {
    // tmux session names can't contain slashes (they'd be interpreted
    // as part of the target syntax).
    expect(
      generateTmuxSessionName('/path/to/repo', 'feature/foo'),
    ).toBe('repo_feature_foo')
  })

  test('dots in branch replaced with _', () => {
    expect(generateTmuxSessionName('/path/to/repo', 'v1.2.3')).toBe(
      'repo_v1_2_3',
    )
  })

  test('dots in repo name replaced with _', () => {
    expect(generateTmuxSessionName('/path/to/my.repo', 'main')).toBe(
      'my_repo_main',
    )
  })

  test('relative path: basename still extracted', () => {
    expect(generateTmuxSessionName('./myrepo', 'main')).toBe('myrepo_main')
  })

  test('trailing slash on path: basename returns the directory name', () => {
    // path.basename('/path/to/repo/') returns 'repo' on POSIX.
    expect(generateTmuxSessionName('/path/to/repo/', 'main')).toBe(
      'repo_main',
    )
  })

  test('branch with hyphens preserved', () => {
    expect(generateTmuxSessionName('/path/repo', 'feat-add-auth')).toBe(
      'repo_feat-add-auth',
    )
  })

  test('mixed dots + slashes: all converted', () => {
    expect(generateTmuxSessionName('/path/my.repo', 'feat/v1.0')).toBe(
      'my_repo_feat_v1_0',
    )
  })
})

describe('worktreeBranchName', () => {
  test('simple slug → "worktree-slug"', () => {
    expect(worktreeBranchName('foo')).toBe('worktree-foo')
  })

  test('nested slug: / → + (D/F conflict avoidance)', () => {
    // Documented contract: "user/feature" must NOT produce a branch
    // ref that conflicts with the parent dir "worktree-user".
    expect(worktreeBranchName('user/feature')).toBe('worktree-user+feature')
  })

  test('multiple slashes all flattened', () => {
    expect(worktreeBranchName('a/b/c')).toBe('worktree-a+b+c')
  })

  test('hyphens in slug preserved', () => {
    expect(worktreeBranchName('feat-add-auth')).toBe(
      'worktree-feat-add-auth',
    )
  })

  test('underscores in slug preserved', () => {
    expect(worktreeBranchName('snake_case')).toBe('worktree-snake_case')
  })

  test('dots in slug preserved', () => {
    expect(worktreeBranchName('v1.0')).toBe('worktree-v1.0')
  })

  test('result always starts with "worktree-" prefix', () => {
    for (const slug of ['x', 'a/b', 'feat', 'v1.0']) {
      expect(worktreeBranchName(slug).startsWith('worktree-')).toBe(true)
    }
  })

  test('slug-to-branch mapping is INJECTIVE for VALID slugs', () => {
    // Documented contract: + is NOT in the slug allowlist
    // ([a-zA-Z0-9._-]). So slugs that pass validateWorktreeSlug
    // produce unique branch names.
    // 'user+feature' is INVALID (+ not allowed), so we don't include it.
    const validSlugs = ['user/feature', 'user-feature', 'user']
    const branches = validSlugs.map(worktreeBranchName)
    expect(new Set(branches).size).toBe(branches.length)
  })
})

describe('worktreeBranchName + generateTmuxSessionName: composition', () => {
  test('generated branch can pass through tmux session naming', () => {
    const branch = worktreeBranchName('feat/v1.0')
    // = 'worktree-feat+v1.0'
    const session = generateTmuxSessionName('/path/repo', branch)
    // Dots get replaced with _ in tmux session, but + survives.
    expect(session).toBe('repo_worktree-feat+v1_0')
  })
})
