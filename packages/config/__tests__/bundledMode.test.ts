import { describe, expect, test } from 'bun:test'
import { isBundledMainPath } from '../bundledMode.js'

describe('isBundledMainPath — bundled-mode prefix detection', () => {
  // Per Bun's StandaloneModuleGraph.zig, compiled binaries mount their
  // embedded JS bundle under a synthetic FS whose prefix is platform-
  // dependent: `/$bunfs/` on macOS/Linux, `B:\~BUN\` on Windows (or the
  // POSIX-normalized form `B:/~BUN/`). We need to accept all three.

  test('macOS/Linux compiled binary entrypoint is detected', () => {
    expect(isBundledMainPath('/$bunfs/root/cli.js')).toBe(true)
  })

  test('Windows compiled binary canonical (backslash) form is detected', () => {
    // This is the form Bun reports natively on Windows. The bug fixed
    // here was: only `/$bunfs/` was being checked, so this returned
    // false on every Windows release binary, cascading into the legacy
    // npm-based auto-updater that fails with "npm i -g <empty>".
    expect(isBundledMainPath('B:\\~BUN\\root\\cli.js')).toBe(true)
  })

  test('Windows POSIX-normalized (forward slash) form is detected', () => {
    // After path normalization (e.g. via path.posix or platformToPosix
    // helpers inside Bun and downstream code), backslashes flip to
    // forward slashes. We accept this form too so the check survives
    // any normalization that happens between Bun.main and our caller.
    expect(isBundledMainPath('B:/~BUN/root/cli.js')).toBe(true)
  })

  test('regular on-disk macOS path → false', () => {
    expect(isBundledMainPath('/Users/icarus/code/ccb/dist/cli.js')).toBe(false)
  })

  test('regular on-disk Linux path → false', () => {
    expect(isBundledMainPath('/home/icarus/.local/bin/ccb')).toBe(false)
  })

  test('regular on-disk Windows path → false', () => {
    expect(
      isBundledMainPath('C:\\Users\\Lucia\\AppData\\Local\\Programs\\ccb\\bin\\ccb.exe'),
    ).toBe(false)
  })

  test('lookalike paths that share the suffix but not the prefix → false', () => {
    expect(isBundledMainPath('/tmp/$bunfs/root/cli.js')).toBe(false)
    expect(isBundledMainPath('D:\\B:\\~BUN\\cli.js')).toBe(false)
  })

  test('empty string → false', () => {
    expect(isBundledMainPath('')).toBe(false)
  })
})
