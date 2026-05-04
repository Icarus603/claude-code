import { describe, expect, test } from 'bun:test'
import { resolve } from 'path'
import {
  containsPathTraversal,
  expandPath,
  normalizePathForConfigKey,
  toRelativePath,
  getDirectoryForPath,
} from '@claude-code/storage/path.js'
import { getCwd } from '@claude-code/app-host/bootstrap/cwd.js'

// toRelativePath uses getCwd() (agent state, realpathSync-resolved at init)
// as reference, NOT process.cwd(). On Linux runners (e.g. GitHub Actions
// /home/runner/work/...) realpathSync resolves to a different inode than
// process.cwd() reports, so tests that built absolute paths with
// process.cwd() got "outside cwd" verdicts. Anchor on getCwd() so the
// test exercises toRelativePath's actual contract on every platform.
const TEST_CWD = getCwd()

// ─── containsPathTraversal ──────────────────────────────────────────────

describe('containsPathTraversal', () => {
  test('detects ../ at start', () => {
    expect(containsPathTraversal('../foo')).toBe(true)
  })

  test('detects ../ in middle', () => {
    expect(containsPathTraversal('foo/../bar')).toBe(true)
  })

  test('detects .. at end', () => {
    expect(containsPathTraversal('foo/..')).toBe(true)
  })

  test('detects standalone ..', () => {
    expect(containsPathTraversal('..')).toBe(true)
  })

  test('detects backslash traversal', () => {
    expect(containsPathTraversal('foo\\..\\bar')).toBe(true)
  })

  test('returns false for normal path', () => {
    expect(containsPathTraversal('foo/bar/baz')).toBe(false)
  })

  test('returns false for single dot', () => {
    expect(containsPathTraversal('./foo')).toBe(false)
  })

  test('returns false for ... in filename', () => {
    expect(containsPathTraversal('foo/...bar')).toBe(false)
  })

  test('returns false for empty string', () => {
    expect(containsPathTraversal('')).toBe(false)
  })

  test('returns false for dotdot in filename without separator', () => {
    expect(containsPathTraversal('foo..bar')).toBe(false)
  })

  test('detects backslash traversal foo\\..\\bar', () => {
    expect(containsPathTraversal('foo\\..\\bar')).toBe(true)
  })

  test('detects .. at end of absolute path', () => {
    expect(containsPathTraversal('/path/to/..')).toBe(true)
  })
})

// ─── expandPath ─────────────────────────────────────────────────────────

describe('expandPath', () => {
  test('expands ~/ to home directory', () => {
    const result = expandPath('~/Documents')
    expect(result).not.toContain('~')
    expect(result).toContain('Documents')
  })

  test('expands bare ~ to home directory', () => {
    const result = expandPath('~')
    expect(result).not.toContain('~')
    // Should equal home directory
    const { homedir } = require('os')
    expect(result).toBe(homedir())
  })

  test('passes absolute paths through normalized', () => {
    expect(expandPath('/usr/local/bin')).toBe('/usr/local/bin')
  })

  test('resolves relative path against baseDir', () => {
    expect(expandPath('src', '/project')).toBe('/project/src')
  })

  test('returns baseDir for empty string', () => {
    expect(expandPath('', '/project')).toBe('/project')
  })

  test('returns cwd-based path for empty string without baseDir', () => {
    const result = expandPath('')
    // Should be a valid absolute path (cwd normalized)
    const { isAbsolute } = require('path')
    expect(isAbsolute(result)).toBe(true)
  })
})

// ─── normalizePathForConfigKey ──────────────────────────────────────────

describe('normalizePathForConfigKey', () => {
  test('normalizes forward slashes (no change on POSIX)', () => {
    expect(normalizePathForConfigKey('foo/bar/baz')).toBe('foo/bar/baz')
  })

  test('resolves dot segments', () => {
    expect(normalizePathForConfigKey('foo/./bar')).toBe('foo/bar')
  })

  test('resolves double-dot segments', () => {
    expect(normalizePathForConfigKey('foo/bar/../baz')).toBe('foo/baz')
  })

  test('handles absolute path', () => {
    const result = normalizePathForConfigKey('/Users/test/project')
    expect(result).toBe('/Users/test/project')
  })

  test('converts backslashes to forward slashes', () => {
    const result = normalizePathForConfigKey('foo\\bar\\baz')
    expect(result).toBe('foo/bar/baz')
  })

  test('normalizes mixed separators foo/bar\\baz', () => {
    const result = normalizePathForConfigKey('foo/bar\\baz')
    expect(result).toBe('foo/bar/baz')
  })

  test('normalizes redundant separators foo//bar', () => {
    const result = normalizePathForConfigKey('foo//bar')
    expect(result).toBe('foo/bar')
  })
})

// ─── toRelativePath ─────────────────────────────────────────────────────

describe('toRelativePath', () => {
  test('returns relative path for a child of cwd', () => {
    // Build a path that is inside the current working directory.
    // resolve() returns an absolute path, and toRelativePath should give
    // back just the final segment (or relative form without ..).
    const abs = resolve(TEST_CWD, 'package.json')
    const result = toRelativePath(abs)
    expect(result).toBe('package.json')
    expect(result).not.toContain('..')
  })

  test('returns absolute path when target is outside cwd', () => {
    // A well-known absolute path that is always outside any typical cwd
    // (any absolute path that doesn't start with process.cwd() will work)
    // Build a path guaranteed to be outside cwd by going to the root's parent
    // of cwd, then a sibling directory with an unlikely name
    const outsidePath = resolve(TEST_CWD, '../../__unlikely_dir_xyz__')
    const result = toRelativePath(outsidePath)
    // relative(cwd, outsidePath) will start with '../..' so function returns absolute
    expect(result).toBe(outsidePath)
  })

  test('returns empty string for cwd itself', () => {
    const result = toRelativePath(TEST_CWD)
    // relative(cwd, cwd) === '' which does not start with '..'
    expect(result).toBe('')
  })

  test('returns a string for any absolute path', () => {
    const abs = resolve(TEST_CWD, 'packages')
    const result = toRelativePath(abs)
    expect(typeof result).toBe('string')
  })
})

// ─── getDirectoryForPath ─────────────────────────────────────────────────

describe('getDirectoryForPath', () => {
  test('returns the path itself when given an existing directory', () => {
    // The packages directory is guaranteed to exist in this repo
    const dir = resolve(process.cwd(), 'packages')
    const result = getDirectoryForPath(dir)
    expect(result).toBe(dir)
  })

  test('returns parent directory for a known file', () => {
    // package.json is at the repo root
    const file = resolve(process.cwd(), 'package.json')
    const expectedParent = process.cwd()
    const result = getDirectoryForPath(file)
    expect(result).toBe(expectedParent)
  })

  test('returns parent directory for a non-existent path', () => {
    const nonExistent = resolve(process.cwd(), 'does-not-exist-xyz123.ts')
    const expectedParent = process.cwd()
    const result = getDirectoryForPath(nonExistent)
    expect(result).toBe(expectedParent)
  })
})
