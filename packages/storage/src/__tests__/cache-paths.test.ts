import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { CACHE_PATHS, setCwdFn, setDjb2HashFn } from '../cache-paths.js'

const realCwd = process.cwd

beforeEach(() => {
  // Reset to defaults before each test.
  setCwdFn(() => '/users/test-home/myproject')
})

afterEach(() => {
  // Restore real cwd function after each test.
  setCwdFn(() => realCwd.call(process))
})

describe('CACHE_PATHS — basic structure', () => {
  test('baseLogs returns a path containing the sanitized project dir', () => {
    setCwdFn(() => '/users/test/myproject')
    const result = CACHE_PATHS.baseLogs()
    expect(result).toContain('users-test-myproject')
  })

  test('errors path is baseLogs + /errors', () => {
    setCwdFn(() => '/proj')
    expect(CACHE_PATHS.errors()).toMatch(/proj.*[/\\]errors$/)
  })

  test('messages path is baseLogs + /messages', () => {
    setCwdFn(() => '/proj')
    expect(CACHE_PATHS.messages()).toMatch(/proj.*[/\\]messages$/)
  })

  test('mcpLogs returns a path with mcp-logs-<server> suffix', () => {
    setCwdFn(() => '/proj')
    expect(CACHE_PATHS.mcpLogs('myserver')).toMatch(/mcp-logs-myserver$/)
  })
})

describe('sanitizePath via CACHE_PATHS — character replacement', () => {
  test('replaces / with -', () => {
    setCwdFn(() => '/a/b/c')
    expect(CACHE_PATHS.baseLogs()).toContain('-a-b-c')
  })

  test('replaces special chars with -', () => {
    setCwdFn(() => '/path with spaces/a@b#c')
    expect(CACHE_PATHS.baseLogs()).toMatch(/-path-with-spaces-a-b-c/)
  })

  test('replaces unicode with -', () => {
    setCwdFn(() => '/path/世界')
    expect(CACHE_PATHS.baseLogs()).toContain('-path---')
  })

  test('preserves alphanumeric', () => {
    setCwdFn(() => '/abc123XYZ')
    expect(CACHE_PATHS.baseLogs()).toContain('-abc123XYZ')
  })

  test('mcpLogs sanitizes server name (Windows colon compat)', () => {
    setCwdFn(() => '/proj')
    // Server name with colons (Windows drive letter chars) must be sanitized
    // because colons are reserved on Windows filesystem.
    expect(CACHE_PATHS.mcpLogs('foo:bar:baz')).toMatch(/mcp-logs-foo-bar-baz$/)
  })

  test('mcpLogs sanitizes server name with spaces', () => {
    setCwdFn(() => '/proj')
    expect(CACHE_PATHS.mcpLogs('my server')).toMatch(/mcp-logs-my-server$/)
  })
})

describe('sanitizePath via CACHE_PATHS — length bound + hash fallback', () => {
  // Critical contract: paths longer than 200 chars get appended with a
  // base-36 djb2 hash to disambiguate truncated names. Without this,
  // two long paths sharing the first 200 chars would collide.

  test('paths under 200 chars are NOT hash-suffixed', () => {
    // Use a distinctive cwd so the resulting sanitized name is well under 200
    // and easy to verify.
    setCwdFn(() => '/short/project')
    const path = CACHE_PATHS.baseLogs()
    const segments = path.split(/[/\\]/)
    const projectDirName = segments[segments.length - 1]!
    // Should be exactly "-short-project" (sanitized — leading slash → -).
    expect(projectDirName).toBe('-short-project')
    // No additional hash suffix.
    expect(projectDirName.length).toBeLessThan(200)
  })

  test('paths exactly 200 sanitized chars are NOT hash-suffixed (≤ check)', () => {
    setCwdFn(() => 'a'.repeat(200))
    const path = CACHE_PATHS.baseLogs()
    // The sanitized name is "a"*200 = exactly 200, which is ≤ 200
    // boundary so no hash. Verify the boundary handling.
    const segments = path.split(/[/\\]/)
    const projectDirName = segments[segments.length - 1]
    // No -<base36> suffix expected.
    expect(projectDirName).toBe('a'.repeat(200))
  })

  test('paths over 200 sanitized chars ARE hash-suffixed', () => {
    const longInput = 'a'.repeat(250)
    setCwdFn(() => longInput)
    const path = CACHE_PATHS.baseLogs()
    const segments = path.split(/[/\\]/)
    const projectDirName = segments[segments.length - 1]!
    // Should be 200-char prefix + "-<hash-base36>".
    expect(projectDirName.startsWith('a'.repeat(200))).toBe(true)
    expect(projectDirName).toMatch(/^a{200}-[0-9a-z]+$/)
  })

  test('different long paths with same 200-char prefix get DIFFERENT hash suffixes', () => {
    // Critical disambiguation: two repos that happen to share a 200-char
    // prefix must NOT collide in the cache directory. Hash captures
    // the FULL name.
    const a = 'a'.repeat(200) + 'X'
    const b = 'a'.repeat(200) + 'Y'
    setCwdFn(() => a)
    const aPath = CACHE_PATHS.baseLogs()
    setCwdFn(() => b)
    const bPath = CACHE_PATHS.baseLogs()
    expect(aPath).not.toBe(bPath)
  })

  test('djb2 hash override works (DI verified)', () => {
    setDjb2HashFn(() => 0xdeadbeef)
    setCwdFn(() => 'a'.repeat(250))
    const path = CACHE_PATHS.baseLogs()
    // 0xdeadbeef = 3735928559 in base36.
    const expected = (0xdeadbeef).toString(36)
    expect(path).toContain(`-${expected}`)
    // Reset to default.
    setDjb2HashFn(s => {
      let h = 5381
      for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
      return h >>> 0
    })
  })

  test('hash uses base 36 (not hex)', () => {
    setCwdFn(() => 'a'.repeat(250))
    const path = CACHE_PATHS.baseLogs()
    const match = path.match(/-([0-9a-z]+)$/)!
    // Verify it's a valid base-36 string (only 0-9 and a-z).
    expect(match[1]).toMatch(/^[0-9a-z]+$/)
    // Should not contain uppercase.
    expect(match[1]).toBe(match[1]!.toLowerCase())
  })
})

describe('CACHE_PATHS — DI', () => {
  test('setCwdFn changes the resolved path', () => {
    setCwdFn(() => '/path-a')
    const a = CACHE_PATHS.baseLogs()
    setCwdFn(() => '/path-b')
    const b = CACHE_PATHS.baseLogs()
    expect(a).not.toBe(b)
    expect(a).toContain('-path-a')
    expect(b).toContain('-path-b')
  })

  test('CACHE_PATHS calls cwd() each time (NOT memoized)', () => {
    // Critical: lazy evaluation. If memoized, switching cwd mid-session
    // (worktree mode) would leave subsequent CACHE_PATHS.* using stale
    // paths.
    let cwdValue = '/initial'
    setCwdFn(() => cwdValue)
    const initial = CACHE_PATHS.baseLogs()
    cwdValue = '/changed'
    const changed = CACHE_PATHS.baseLogs()
    expect(initial).not.toBe(changed)
    expect(changed).toContain('-changed')
  })
})
