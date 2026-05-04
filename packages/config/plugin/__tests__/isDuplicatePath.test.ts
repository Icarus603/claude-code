import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isDuplicatePath } from '../_deps.js'

// Regression test: isDuplicatePath used to be `(a, b) => a === b` — a
// broken 2-arg stub while every caller passed 3 args (fs, filePath,
// loadedPaths). The fs object was compared against a string, always
// returning false, so duplicate-path detection in plugin loaders
// silently never fired. The fix:
//   1. Forwarder signature changed to `(filePath, loadedPaths)`.
//   2. Body resolves symlinks via `require('node:fs').realpathSync`
//      (direct, NOT through the wired PluginFsImpl — name resolution
//      is sandbox-neutral and going direct avoids test-isolation
//      hazards from the module-level `_fs` slot).
//   3. All 6 callers updated to drop the `fs` arg.

const TMP = join(tmpdir(), `ccb-isDuplicatePath-${process.pid}-${Date.now()}`)

mkdirSync(TMP, { recursive: true })

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('isDuplicatePath', () => {
  test('first call adds the path to the set and returns false', () => {
    const file = join(TMP, 'first.md')
    writeFileSync(file, '')
    const seen = new Set<string>()
    expect(isDuplicatePath(file, seen)).toBe(false)
    expect(seen.size).toBe(1)
  })

  test('second call with same path returns true (already in set)', () => {
    const file = join(TMP, 'second.md')
    writeFileSync(file, '')
    const seen = new Set<string>()
    isDuplicatePath(file, seen)
    expect(isDuplicatePath(file, seen)).toBe(true)
  })

  test('symlink and target resolve to the same canonical path → second call dedupes', () => {
    const target = join(TMP, `real-${Math.random().toString(36).slice(2)}.md`)
    const link = join(TMP, `link-${Math.random().toString(36).slice(2)}.md`)
    writeFileSync(target, '')
    symlinkSync(target, link)
    // Sanity: realpathSync resolves the symlink to its target.
    expect(realpathSync(link)).toBe(realpathSync(target))
    const seen = new Set<string>()
    expect(isDuplicatePath(target, seen)).toBe(false)
    // The symlink path is different at the literal level but realpathSync
    // resolves it to `target`. The previous broken stub would have missed
    // this because it never called realpathSync.
    expect(isDuplicatePath(link, seen)).toBe(true)
  })

  test('non-existent path falls back to literal path (no throw)', () => {
    const ghost = join(TMP, 'does-not-exist.md')
    const seen = new Set<string>()
    expect(isDuplicatePath(ghost, seen)).toBe(false)
    expect(isDuplicatePath(ghost, seen)).toBe(true)
  })

  test('different files produce different entries in the set', () => {
    const a = join(TMP, 'a.md')
    const b = join(TMP, 'b.md')
    writeFileSync(a, '')
    writeFileSync(b, '')
    const seen = new Set<string>()
    expect(isDuplicatePath(a, seen)).toBe(false)
    expect(isDuplicatePath(b, seen)).toBe(false)
    expect(seen.size).toBe(2)
  })
})
