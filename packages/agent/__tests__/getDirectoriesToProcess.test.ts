/**
 * Tests for getDirectoriesToProcess — pure path-walker that decides
 * which directories' CLAUDE.md / .claude/rules/*.md files get loaded.
 *
 * Wrong walk = wrong memory files in the system prompt. Edge cases:
 *   - target outside cwd → no nested dirs
 *   - target IS cwd → no nested dirs
 *   - target deeper than cwd → walk includes intermediate dirs
 *   - cwd is FS root → walks all the way up to '/' (no infinite loop)
 *
 * cwdLevelDirs walks ROOT → CWD; nestedDirs walks CWD → TARGET.
 * Together: every directory between FS root and the target file gets a
 * chance to contribute memory rules.
 */
import { describe, expect, test } from 'bun:test'
import { sep } from 'node:path'
import { getDirectoriesToProcess } from '../attachments.js'

describe('getDirectoriesToProcess — nestedDirs', () => {
  test('target inside cwd: includes target dir', () => {
    const { nestedDirs } = getDirectoriesToProcess(
      '/proj/a/b/file.ts',
      '/proj',
    )
    expect(nestedDirs).toEqual(['/proj/a', '/proj/a/b'])
  })

  test('target IS cwd (file at cwd root): empty nested', () => {
    // dirname('/proj/file.ts') = '/proj' === cwd → no walk.
    const { nestedDirs } = getDirectoriesToProcess(
      '/proj/file.ts',
      '/proj',
    )
    expect(nestedDirs).toEqual([])
  })

  test('target outside cwd: empty nested', () => {
    // /elsewhere/file.ts is not inside /proj — startsWith check fails.
    const { nestedDirs } = getDirectoriesToProcess(
      '/elsewhere/file.ts',
      '/proj',
    )
    expect(nestedDirs).toEqual([])
  })

  test('returns nested dirs in order from CWD down to TARGET', () => {
    // Walk goes UP (target → cwd), then reverses, so result is
    // [closest-to-cwd, ..., target's dir].
    const { nestedDirs } = getDirectoriesToProcess(
      '/proj/a/b/c/file.ts',
      '/proj',
    )
    expect(nestedDirs).toEqual([
      '/proj/a',
      '/proj/a/b',
      '/proj/a/b/c',
    ])
  })

  test('relative-target-resolved against process.cwd()', () => {
    // The function uses resolve() on the target. A relative path is
    // resolved against process.cwd(). We can't predict the answer
    // exactly without knowing process.cwd(), but we can assert it's
    // an absolute path-derived result.
    const { nestedDirs } = getDirectoriesToProcess('foo.ts', '/proj')
    // Either empty (if process.cwd() isn't under /proj) or contains
    // absolute paths.
    for (const d of nestedDirs) {
      expect(d.startsWith(sep)).toBe(true)
    }
  })
})

describe('getDirectoriesToProcess — cwdLevelDirs', () => {
  test('walks ROOT → CWD', () => {
    const { cwdLevelDirs } = getDirectoriesToProcess(
      '/proj/file.ts',
      '/proj',
    )
    // From root '/' up to '/proj': just '/proj' (the loop stops when
    // currentDir === root, so '/' itself is not pushed).
    expect(cwdLevelDirs).toEqual(['/proj'])
  })

  test('deep cwd: includes all intermediate dirs', () => {
    const { cwdLevelDirs } = getDirectoriesToProcess(
      '/a/b/c/d/file.ts',
      '/a/b/c/d',
    )
    // Walk: /a/b/c/d → /a/b/c → /a/b → /a (stop at root '/')
    // Reverse: /a, /a/b, /a/b/c, /a/b/c/d
    expect(cwdLevelDirs).toEqual(['/a', '/a/b', '/a/b/c', '/a/b/c/d'])
  })

  test('cwd is filesystem root: empty list', () => {
    // currentDir === parse(currentDir).root === '/' — loop never enters.
    const { cwdLevelDirs } = getDirectoriesToProcess('/file.ts', '/')
    expect(cwdLevelDirs).toEqual([])
  })
})

describe('getDirectoriesToProcess — combined', () => {
  test('typical case: nested + cwdLevel both populated', () => {
    const r = getDirectoriesToProcess(
      '/home/user/proj/src/file.ts',
      '/home/user/proj',
    )
    expect(r.nestedDirs).toEqual([
      '/home/user/proj/src',
    ])
    expect(r.cwdLevelDirs).toEqual([
      '/home',
      '/home/user',
      '/home/user/proj',
    ])
  })

  test('target outside cwd: nested empty, cwdLevel populated', () => {
    const r = getDirectoriesToProcess('/other/file.ts', '/proj')
    expect(r.nestedDirs).toEqual([])
    expect(r.cwdLevelDirs).toEqual(['/proj'])
  })

  test('no infinite loop when cwd is unreachable from target', () => {
    // The walk stops at FS root regardless. We just verify no hang.
    const r = getDirectoriesToProcess('/a/file.ts', '/b/c')
    // /a is NOT under /b/c → nestedDirs empty.
    // /b/c walks to /b/c, /b → reverse → ['/b', '/b/c']
    expect(r.nestedDirs).toEqual([])
    expect(r.cwdLevelDirs).toEqual(['/b', '/b/c'])
  })
})
