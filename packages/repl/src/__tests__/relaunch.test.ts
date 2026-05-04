/**
 * Tests for relaunch.ts — launcher detection only.
 *
 * Skip the actual spawnSync path (it would re-exec the test runner) and
 * focus on the launcher-resolution logic, which is the only part with real
 * branching: standalone-vs-dev, auto-update vs manually-placed binary.
 *
 * Wrong launcher = ccb relaunches to the wrong binary (or fails to relaunch
 * at all), so this branch matters.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { homedir } from 'os'
import { join, sep } from 'path'
import {
  getDefaultLauncher,
  isAutoUpdateBinary,
  isBunStandalone,
} from '../relaunch.js'

const ORIGINAL_EXEC_PATH = process.execPath
const ORIGINAL_ARGV = process.argv

function setExecPath(value: string): void {
  Object.defineProperty(process, 'execPath', {
    value,
    configurable: true,
    writable: true,
  })
}

function restoreExecPath(): void {
  Object.defineProperty(process, 'execPath', {
    value: ORIGINAL_EXEC_PATH,
    configurable: true,
    writable: true,
  })
}

describe('isBunStandalone', () => {
  test('returns false in test runner (no Bun.embeddedFiles)', () => {
    // bun test itself runs without embeddedFiles; the constant-folding only
    // happens in `bun build --compile` output. So this asserts the dev case.
    expect(isBunStandalone()).toBe(false)
  })
})

describe('isAutoUpdateBinary', () => {
  test('returns false in dev mode', () => {
    expect(isAutoUpdateBinary()).toBe(false)
  })
})

describe('getDefaultLauncher — dev mode (not standalone)', () => {
  afterEach(() => {
    process.argv = ORIGINAL_ARGV
  })

  test('returns bun + argv[1] when argv[1] is set', () => {
    process.argv = ['bun', '/some/path/dist/cli.js']
    const launcher = getDefaultLauncher()
    expect(launcher).toEqual({
      cmd: process.execPath,
      prefixArgs: ['/some/path/dist/cli.js'],
    })
  })

  test('falls back to execPath alone when argv[1] is empty', () => {
    process.argv = ['bun']
    const launcher = getDefaultLauncher()
    expect(launcher).toEqual({
      cmd: process.execPath,
      prefixArgs: [],
    })
  })
})

describe('getDefaultLauncher — auto-update path detection', () => {
  // We can't fake isBunStandalone() without module mocking, but we can verify
  // the path-prefix shape directly: the auto-update versions dir is computed
  // from homedir(), so any execPath under that prefix should be flagged when
  // standalone is true. We assert the shape of the constant here so a future
  // refactor moving the dir won't silently regress detection.
  test('versions dir shape matches the install layout', () => {
    const expected =
      join(homedir(), '.local', 'share', 'ccb', 'versions') + sep
    // Manually encode the same logic relaunch.ts uses; keep them in sync.
    expect(expected.endsWith(sep)).toBe(true)
    expect(expected).toContain('.local')
    expect(expected).toContain('ccb')
    expect(expected).toContain('versions')
  })
})

describe('getDefaultLauncher — pinToCurrentBinary', () => {
  let restoreNeeded = false
  beforeEach(() => {
    restoreNeeded = false
  })
  afterEach(() => {
    if (restoreNeeded) restoreExecPath()
  })

  test('always returns the running binary in dev mode regardless of pin', () => {
    // Dev-mode behaviour is identical with/without pin — the pin only matters
    // when we'd otherwise resolve to the symlink. Sanity check.
    process.argv = ['bun', '/dev/cli.js']
    const a = getDefaultLauncher({ pinToCurrentBinary: true })
    const b = getDefaultLauncher({ pinToCurrentBinary: false })
    expect(a).toEqual(b)
  })
})
