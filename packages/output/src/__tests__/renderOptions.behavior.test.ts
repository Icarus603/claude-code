import { describe, expect, test } from 'bun:test'

import { getBaseRenderOptions } from '../render-options.ts'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin `render-options.ts` — controls how Ink reads stdin in REPL launches.
 *
 * Critical invariants:
 *  1. Default exitOnCtrlC = false (dialogs should NOT exit the whole
 *     process on Ctrl+C). Pin so refactors can't flip the default.
 *  2. Stdin override is cached at module scope (computed ONCE per process).
 *  3. Override is SKIPPED in: TTY stdin / CI env / `mcp` subcommand /
 *     Windows / open('/dev/tty') failure.
 *  4. When override succeeds: isTTY flag is FORCED to true on the
 *     ReadStream (Bun compiled binaries don't auto-detect this).
 *  5. logError is called on tty-open failure (NOT silent).
 */
describe('getBaseRenderOptions', () => {
  test('default exitOnCtrlC = false', () => {
    // Pin: dialogs use this default so Ctrl+C in a dialog cancels the
    // dialog, not the whole REPL. A regression to true would crash on
    // every Ctrl+C in any dialog.
    const opts = getBaseRenderOptions()
    expect(opts.exitOnCtrlC).toBe(false)
  })

  test('explicit exitOnCtrlC = true is honored', () => {
    const opts = getBaseRenderOptions(true)
    expect(opts.exitOnCtrlC).toBe(true)
  })

  test('returned object has exitOnCtrlC key', () => {
    const opts = getBaseRenderOptions()
    expect('exitOnCtrlC' in opts).toBe(true)
  })

  test('stdin key only present when override succeeded', () => {
    // In bun:test, process.stdin is a TTY (no override needed) OR
    // CI/test env disables override. Either way: stdin key absent.
    const opts = getBaseRenderOptions()
    // Pin: explicit absence of stdin key when no override.
    // (If override IS active, stdin is a ReadStream.)
    if (opts.stdin === undefined) {
      expect('stdin' in opts).toBe(false)
    } else {
      // Should be a ReadStream
      expect(opts.stdin).toBeDefined()
    }
  })

  test('multiple calls return consistent shape (cached stdin)', () => {
    // Pin: cache means repeated calls don't re-try /dev/tty.
    const a = getBaseRenderOptions(false)
    const b = getBaseRenderOptions(false)
    expect(a.exitOnCtrlC).toBe(b.exitOnCtrlC)
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort())
  })
})

describe('render-options — source pins', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'render-options.ts'),
    'utf-8',
  )

  test('cachedStdinOverride initialised to null (= NOT YET COMPUTED)', () => {
    // Pin: null is the cache-miss sentinel. undefined is a valid
    // cache-hit value (= no override). Don't conflate.
    expect(source).toMatch(
      /let cachedStdinOverride: ReadStream \| undefined \| null = null/,
    )
  })

  test('cache check uses !== null (NOT a falsy check)', () => {
    // Pin: !== null distinguishes "no override" (undefined) from
    // "not yet computed" (null). A `!cachedStdinOverride` check would
    // re-compute when override is undefined.
    expect(source).toMatch(
      /if \(cachedStdinOverride !== null\) \{\s*\n?\s*return cachedStdinOverride/,
    )
  })

  test('TTY stdin skips override (already interactive)', () => {
    expect(source).toMatch(
      /if \(process\.stdin\.isTTY\) \{\s*\n?\s*cachedStdinOverride = undefined/,
    )
  })

  test('CI env skips override (no interactivity in CI)', () => {
    expect(source).toMatch(
      /if \(isEnvTruthy\(process\.env\.CI\)\) \{\s*\n?\s*cachedStdinOverride = undefined/,
    )
  })

  test('mcp subcommand skips override (MCP needs stdin)', () => {
    expect(source).toMatch(
      /if \(process\.argv\.includes\('mcp'\)\) \{\s*\n?\s*cachedStdinOverride = undefined/,
    )
  })

  test('Windows skips override (no /dev/tty on win32)', () => {
    expect(source).toMatch(
      /if \(process\.platform === 'win32'\) \{\s*\n?\s*cachedStdinOverride = undefined/,
    )
  })

  test('opens /dev/tty in read mode', () => {
    expect(source).toMatch(/openSync\('\/dev\/tty', 'r'\)/)
  })

  test('explicitly sets ttyStream.isTTY = true (Bun compiled binary fix)', () => {
    // Pin: see comment in source. Bun compiled binaries don't auto-
    // detect isTTY on a FD-backed ReadStream.
    expect(source).toMatch(/ttyStream\.isTTY = true/)
  })

  test('open failure: logError + cache undefined + return undefined', () => {
    expect(source).toMatch(
      /catch \(err\) \{\s*\n?\s*logError\(err as Error\)\s*\n?\s*cachedStdinOverride = undefined\s*\n?\s*return undefined/,
    )
  })

  test('getBaseRenderOptions defaults exitOnCtrlC param to false', () => {
    // Pin: in TS, default parameter value `: boolean = false`.
    expect(source).toMatch(/exitOnCtrlC: boolean = false/)
  })

  test('stdin key conditionally added (NOT { stdin: undefined } in result)', () => {
    // Pin: if check before assignment. A regression to always-assign
    // would set stdin to undefined explicitly, which Ink treats
    // differently than absent key.
    expect(source).toMatch(/if \(stdin\) \{\s*\n?\s*options\.stdin = stdin\s*\n?\s*\}/)
  })
})
