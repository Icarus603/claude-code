import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin `lockfile.ts` — lazy accessor for proper-lockfile. The whole point
 * of this file is to keep graceful-fs's ~8ms monkey-patch out of startup.
 *
 * Critical invariants:
 *  1. NO top-level import of proper-lockfile (would pull graceful-fs).
 *  2. Lazy require pattern: module-level cache + getLockfile() helper.
 *  3. Each public fn calls getLockfile().X — no inlined require.
 *  4. ALL 4 functions exported: lock, lockSync, unlock, check.
 *  5. Type-only import is fine (compile-time only, no runtime cost).
 */
describe('lockfile lazy accessor — source pins', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'lockfile.ts'),
    'utf-8',
  )

  test('NO top-level runtime import of proper-lockfile', () => {
    // Pin: top-level import would defeat the whole module. Type-only is
    // fine.
    expect(source).not.toMatch(
      /^import \{[^}]*\} from ['"]proper-lockfile['"]/m,
    )
  })

  test('type-only import is allowed (compile-time only)', () => {
    // Pin: import type is the canonical way to get types without runtime
    // cost. Must be `import type ...` form.
    expect(source).toMatch(
      /^import type \{ CheckOptions, LockOptions, UnlockOptions \} from 'proper-lockfile'/m,
    )
  })

  test('module-level cache `_lockfile` (let, NOT const)', () => {
    // Pin: must be `let` (mutable). const would prevent assignment.
    expect(source).toMatch(/let _lockfile: Lockfile \| undefined/)
  })

  test('getLockfile() guards with `if (!_lockfile)` before require', () => {
    // Pin: idempotent — only require once.
    expect(source).toMatch(
      /function getLockfile\(\): Lockfile \{\s*\n?\s*if \(!_lockfile\) \{\s*\n?\s*[\s\S]*?require\('proper-lockfile'\)/,
    )
  })

  test('require uses string literal "proper-lockfile" (NOT computed)', () => {
    // Pin: bundlers detect string-literal requires for tree-shaking.
    // Computed paths would defeat lazy loading.
    expect(source).toMatch(/require\('proper-lockfile'\)/)
  })

  test('lock() forwards args (file + options)', () => {
    expect(source).toMatch(
      /lock\([\s\S]+?return getLockfile\(\)\.lock\(file, options\)/,
    )
  })

  test('lockSync() forwards args + has sync signature (returns release fn)', () => {
    expect(source).toMatch(
      /lockSync\(file: string, options\?: LockOptions\): \(\) => void/,
    )
    expect(source).toMatch(/return getLockfile\(\)\.lockSync\(file, options\)/)
  })

  test('unlock() forwards args (file + options)', () => {
    expect(source).toMatch(
      /unlock\([\s\S]+?return getLockfile\(\)\.unlock\(file, options\)/,
    )
  })

  test('check() forwards args + returns Promise<boolean>', () => {
    expect(source).toMatch(
      /check\(file: string, options\?: CheckOptions\): Promise<boolean>/,
    )
    expect(source).toMatch(/return getLockfile\(\)\.check\(file, options\)/)
  })

  test('all 4 exports present (lock, lockSync, unlock, check)', () => {
    // Pin: full surface coverage.
    expect(source).toMatch(/^export function lock\(/m)
    expect(source).toMatch(/^export function lockSync\(/m)
    expect(source).toMatch(/^export function unlock\(/m)
    expect(source).toMatch(/^export function check\(/m)
  })

  test('header doc mentions graceful-fs / 8ms cost reason', () => {
    // Pin: the rationale must stay visible. A regression that removes
    // the comment makes the lazy wrapper look like over-engineering.
    expect(source).toMatch(/graceful-fs/i)
    expect(source).toMatch(/8ms/)
  })
})
