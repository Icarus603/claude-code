import { describe, expect, mock, test } from 'bun:test'
import { homedir } from 'os'
import { sep } from 'path'

// Spread real exports + override only what this test needs.
// See feedback_bun_mock_module_global_scope.md.
const realCwd = await import('@claude-code/app-host/bootstrap/cwd.js')
mock.module('@claude-code/app-host/bootstrap/cwd.js', () => ({
  ...realCwd,
  getCwd: () => '/test/cwd',
}))

const {
  containsPathTraversal,
  expandPath,
  normalizePathForConfigKey,
  toRelativePath,
} = await import('../path.js')

const HOME = homedir()

describe('expandPath', () => {
  test('bare ~ expands to home', () => {
    expect(expandPath('~')).toBe(HOME)
  })
  test('~/path expands to home/path', () => {
    expect(expandPath('~/Documents')).toBe(`${HOME}${sep}Documents`)
  })
  test('absolute path returns normalized', () => {
    expect(expandPath('/foo/bar')).toBe(`${sep}foo${sep}bar`)
  })
  test('relative path resolves against baseDir', () => {
    expect(expandPath('./src', '/project')).toBe(
      `${sep}project${sep}src`,
    )
  })
  test('relative path defaults to mocked cwd', () => {
    expect(expandPath('./foo')).toBe(`${sep}test${sep}cwd${sep}foo`)
  })
  test('throws on null bytes (security)', () => {
    expect(() => expandPath('foo\0bar')).toThrow(/null bytes/)
  })
  test('throws on null bytes in baseDir', () => {
    expect(() => expandPath('foo', '/base\0dir')).toThrow(/null bytes/)
  })
  test('throws TypeError on non-string path', () => {
    // @ts-expect-error — testing runtime error path
    expect(() => expandPath(123)).toThrow(TypeError)
  })
  test('empty path returns normalized baseDir', () => {
    expect(expandPath('   ', '/base/dir')).toBe(`${sep}base${sep}dir`)
  })
  test('whitespace-only path treated as empty', () => {
    expect(expandPath('\t\n', '/x')).toBe(`${sep}x`)
  })
})

describe('toRelativePath', () => {
  test('returns relative path when under cwd', () => {
    expect(toRelativePath('/test/cwd/foo/bar.ts')).toBe(`foo${sep}bar.ts`)
  })
  test('returns absolute path when outside cwd (would start with ..)', () => {
    expect(toRelativePath('/elsewhere/file.ts')).toBe('/elsewhere/file.ts')
  })
  test('returns empty string for cwd itself', () => {
    expect(toRelativePath('/test/cwd')).toBe('')
  })
})

describe('containsPathTraversal', () => {
  test('detects ../foo', () => {
    expect(containsPathTraversal('../foo')).toBe(true)
  })
  test('detects foo/../bar', () => {
    expect(containsPathTraversal('foo/../bar')).toBe(true)
  })
  test('detects path ending with ..', () => {
    expect(containsPathTraversal('foo/..')).toBe(true)
  })
  test('detects backslash form (Windows)', () => {
    expect(containsPathTraversal('foo\\..\\bar')).toBe(true)
  })
  test('does NOT match ".." inside a name', () => {
    expect(containsPathTraversal('foo..bar')).toBe(false)
    expect(containsPathTraversal('my..file')).toBe(false)
  })
  test('does NOT match "..something" prefix', () => {
    expect(containsPathTraversal('..hidden')).toBe(false)
  })
  test('does NOT match plain paths', () => {
    expect(containsPathTraversal('foo/bar')).toBe(false)
    expect(containsPathTraversal('/abs/path')).toBe(false)
  })
  test('detects ../ at start', () => {
    expect(containsPathTraversal('../etc/passwd')).toBe(true)
  })
})

describe('normalizePathForConfigKey', () => {
  test('preserves forward-slashed path', () => {
    expect(normalizePathForConfigKey('/foo/bar')).toBe('/foo/bar')
  })
  test('converts backslashes to forward slashes', () => {
    expect(normalizePathForConfigKey('C:\\foo\\bar')).toBe('C:/foo/bar')
  })
  test('resolves . and .. segments', () => {
    expect(normalizePathForConfigKey('/foo/./bar')).toBe('/foo/bar')
    expect(normalizePathForConfigKey('/foo/baz/../bar')).toBe('/foo/bar')
  })
  test('mixed slashes normalize to forward', () => {
    expect(normalizePathForConfigKey('foo\\bar/baz')).toBe('foo/bar/baz')
  })
  test('empty string returns "."', () => {
    expect(normalizePathForConfigKey('')).toBe('.')
  })
})
