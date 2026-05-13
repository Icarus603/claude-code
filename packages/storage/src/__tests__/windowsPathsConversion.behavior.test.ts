import { describe, expect, test } from 'bun:test'

import {
  posixPathToWindowsPath,
  windowsPathToPosixPath,
} from '../windowsPaths.ts'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin `windowsPaths.ts` — Windows ↔ POSIX path conversions used by Bash
 * tool, git-bash invocations, and path normalization. Bugs here corrupt
 * file paths silently — they look "weird but plausible" so they slip
 * past visual review.
 *
 * Critical invariants:
 *  1. windowsPathToPosixPath:
 *     - UNC `\\server\share` → `//server/share`
 *     - `C:\path` → `/c/path` (lowercase drive letter, MSYS2 style)
 *     - Already-POSIX or relative → just flip slashes.
 *  2. posixPathToWindowsPath:
 *     - UNC `//server/share` → `\\server\share`
 *     - `/cygdrive/c/path` → `C:\path` (uppercase drive letter)
 *     - `/c/path` (MSYS2/Git Bash) → `C:\path` (uppercase drive letter)
 *     - Already-Windows or relative → just flip slashes.
 *  3. Round-trip: posix → windows → posix should yield original
 *     (for the canonical cases).
 *  4. LRU cache (500 entries) on each function — memoization.
 *  5. SECURITY: findExecutable filters CWD-shadowed binaries (prevents
 *     malicious git.bat in project root).
 */
describe('windowsPathToPosixPath', () => {
  test('UNC path \\\\server\\share → //server/share', () => {
    expect(windowsPathToPosixPath('\\\\server\\share')).toBe('//server/share')
    expect(windowsPathToPosixPath('\\\\server\\share\\file.txt')).toBe(
      '//server/share/file.txt',
    )
  })

  test('drive letter C:\\Users → /c/Users (LOWERCASE drive)', () => {
    // Pin: lowercase drive. MSYS2 convention. /C/Users would be unusual.
    expect(windowsPathToPosixPath('C:\\Users\\foo')).toBe('/c/Users/foo')
    expect(windowsPathToPosixPath('D:\\Projects\\bar')).toBe('/d/Projects/bar')
  })

  test('drive letter with forward slash C:/ → /c/...', () => {
    // Pin: tolerates already-mixed paths (C:/ as well as C:\).
    expect(windowsPathToPosixPath('C:/Users/foo')).toBe('/c/Users/foo')
  })

  test('relative path with backslashes → flips to forward slashes', () => {
    expect(windowsPathToPosixPath('foo\\bar\\baz')).toBe('foo/bar/baz')
  })

  test('already-POSIX path → unchanged (no double-conversion)', () => {
    // Pin: regex tolerates already-POSIX input.
    expect(windowsPathToPosixPath('/usr/local/bin')).toBe('/usr/local/bin')
  })

  test('drive letter without path (C:\\) → /c/', () => {
    // Pin: trailing-only drive root.
    expect(windowsPathToPosixPath('C:\\')).toBe('/c/')
  })
})

describe('posixPathToWindowsPath', () => {
  test('UNC path //server/share → \\\\server\\share', () => {
    expect(posixPathToWindowsPath('//server/share')).toBe('\\\\server\\share')
    expect(posixPathToWindowsPath('//server/share/file.txt')).toBe(
      '\\\\server\\share\\file.txt',
    )
  })

  test('cygdrive /cygdrive/c/Users → C:\\Users (UPPERCASE drive)', () => {
    // Pin: uppercase drive — Windows convention. cygdrive form.
    expect(posixPathToWindowsPath('/cygdrive/c/Users/foo')).toBe(
      'C:\\Users\\foo',
    )
  })

  test('MSYS2 /c/Users → C:\\Users (UPPERCASE drive)', () => {
    // Pin: uppercase drive. MSYS2/Git Bash format /c/ (NOT /cygdrive/).
    expect(posixPathToWindowsPath('/c/Users/foo')).toBe('C:\\Users\\foo')
  })

  test('drive letter alone /c → C:\\', () => {
    // Pin: drive-root special case.
    expect(posixPathToWindowsPath('/c')).toBe('C:\\')
  })

  test('cygdrive alone /cygdrive/c → C:\\', () => {
    expect(posixPathToWindowsPath('/cygdrive/c')).toBe('C:\\')
  })

  test('plain POSIX (no drive prefix) → backslash-flipped', () => {
    expect(posixPathToWindowsPath('/usr/local/bin')).toBe('\\usr\\local\\bin')
  })

  test('relative path with forward slashes → backslashes', () => {
    expect(posixPathToWindowsPath('foo/bar/baz')).toBe('foo\\bar\\baz')
  })
})

describe('round-trip conversions', () => {
  test('Windows → POSIX → Windows preserves drive paths', () => {
    // Pin: lossless for the canonical drive-letter case.
    // C:\Users\foo → /c/Users/foo → C:\Users\foo
    const original = 'C:\\Users\\foo'
    expect(posixPathToWindowsPath(windowsPathToPosixPath(original))).toBe(
      original,
    )
  })

  test('POSIX → Windows → POSIX preserves drive paths', () => {
    // /c/Users/foo → C:\Users\foo → /c/Users/foo
    const original = '/c/Users/foo'
    expect(windowsPathToPosixPath(posixPathToWindowsPath(original))).toBe(
      original,
    )
  })

  test('UNC round-trip preserves form', () => {
    expect(
      posixPathToWindowsPath(windowsPathToPosixPath('\\\\server\\share')),
    ).toBe('\\\\server\\share')
  })
})

describe('memoization (LRU cache)', () => {
  test('same input → same reference (cached result)', () => {
    // Pin: memoizeWithLRU returns the same string each call (string
    // primitive — reference equality may not hold, but the result MUST
    // be value-equal).
    const a = windowsPathToPosixPath('C:\\some\\path')
    const b = windowsPathToPosixPath('C:\\some\\path')
    expect(a).toBe(b)
  })

  test('many different inputs all work (LRU doesn\'t corrupt)', () => {
    // Pin: cache size = 500. Beyond that, eviction happens — but never
    // a wrong answer.
    for (let i = 0; i < 1000; i++) {
      const result = windowsPathToPosixPath(`C:\\path${i}`)
      expect(result).toBe(`/c/path${i}`)
    }
  })
})

describe('source pins', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'windowsPaths.ts'),
    'utf-8',
  )

  test('LRU cache size = 500 for each conversion function', () => {
    // Pin: 500 is the documented cache size. A regression to 5000 or 50
    // would change memory/perf profile.
    const matches = source.match(/memoizeWithLRU\(/g)
    expect(matches?.length).toBe(2)
    // Both should pass `500` as the third arg.
    expect(
      (source.match(/\(p: string\) => p,\s*\n\s*500/g) ?? []).length,
    ).toBe(2)
  })

  test('SECURITY: findExecutable filters CWD-shadowed binaries', () => {
    // Pin: critical guard against `git.bat` in project root being run
    // instead of system git. Cannot be removed.
    expect(source).toMatch(
      /Skipping potentially malicious executable in current directory/,
    )
  })

  test('findExecutable for "git" checks default install locations FIRST', () => {
    // Pin: defaults checked before where.exe. A regression that drops
    // this would slow down git lookup AND might pick a wrong git on
    // systems where PATH has been polluted.
    expect(source).toMatch(/executable === 'git'/)
    expect(source).toMatch(
      /'C:\\\\Program Files\\\\Git\\\\cmd\\\\git\.exe'/,
    )
  })

  test('64-bit Program Files BEFORE Program Files (x86)', () => {
    // Pin: prefer 64-bit. The comment says so; pin the order.
    const sixtyFour = source.indexOf("'C:\\\\Program Files\\\\Git\\\\cmd\\\\git.exe'")
    const thirtyTwo = source.indexOf(
      "'C:\\\\Program Files (x86)\\\\Git\\\\cmd\\\\git.exe'",
    )
    expect(sixtyFour).toBeGreaterThan(-1)
    expect(thirtyTwo).toBeGreaterThan(sixtyFour)
  })

  test('SHELL env set only on windows (NOT on macOS/Linux)', () => {
    // Pin: guard on platform === 'windows'. A regression that sets
    // SHELL on macOS would override the user's choice.
    expect(source).toMatch(
      /if \(getPlatform\(\) === 'windows'\) \{[\s\S]+?process\.env\.SHELL = gitBashPath/,
    )
  })

  test('CLAUDE_CODE_GIT_BASH_PATH env var checked first (user override)', () => {
    // Pin: env var → default locations → where.exe.
    expect(source).toMatch(
      /findGitBashPath = memoize[\s\S]+?process\.env\.CLAUDE_CODE_GIT_BASH_PATH/,
    )
  })

  test('bashPath derived from gitPath via ../../bin/bash.exe', () => {
    // Pin: structural relationship between git install dir and bash.exe.
    expect(source).toMatch(
      /pathWin32\.join\(gitPath, '\.\.', '\.\.', 'bin', 'bash\.exe'\)/,
    )
  })
})
