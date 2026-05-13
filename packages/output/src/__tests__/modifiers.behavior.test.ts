import { describe, expect, test } from 'bun:test'

import { isModifierPressed, prewarmModifiers } from '../modifiers.ts'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin `modifiers.ts` — bun:ffi shim (despite the "napi" name) for macOS
 * modifier key state via Carbon. Misnamed historically; CLAUDE.md
 * documents this.
 *
 * Critical invariants:
 *  1. Non-darwin platforms ALWAYS return false (no native module load).
 *  2. prewarm guards against multiple loads via module-level flag.
 *  3. prewarm errors are swallowed (catch/ignore) — load failure must
 *     never crash the host process.
 *  4. isModifierPressed uses dynamic require (NOT top-level import) —
 *     keeps the bun:ffi cost out of cold start.
 */
describe('modifiers — runtime', () => {
  test('isModifierPressed returns false on non-darwin platforms', () => {
    // On Linux/Windows, the function early-returns false without loading
    // the native module. On darwin, depends on actual key state.
    if (process.platform !== 'darwin') {
      expect(isModifierPressed('shift')).toBe(false)
      expect(isModifierPressed('command')).toBe(false)
      expect(isModifierPressed('control')).toBe(false)
      expect(isModifierPressed('option')).toBe(false)
    } else {
      // On darwin, the call should not throw (native module may be
      // present and probe Carbon).
      expect(() => isModifierPressed('shift')).not.toThrow()
    }
  })

  test('prewarmModifiers is a no-op on non-darwin', () => {
    if (process.platform !== 'darwin') {
      expect(() => prewarmModifiers()).not.toThrow()
    }
  })

  test('prewarmModifiers does not throw on second call (idempotent)', () => {
    expect(() => {
      prewarmModifiers()
      prewarmModifiers()
    }).not.toThrow()
  })
})

describe('modifiers — source pins', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'modifiers.ts'),
    'utf-8',
  )

  test('ModifierKey type = shift | command | control | option', () => {
    // Pin: exact union. A regression adding 'function' or 'fn' would
    // break the type narrowing in callers.
    expect(source).toMatch(
      /export type ModifierKey = 'shift' \| 'command' \| 'control' \| 'option'/,
    )
  })

  test('prewarm early-returns when prewarmed flag is set OR platform != darwin', () => {
    // Pin: guard on BOTH conditions. Removing either would
    // re-load the module on every call OR load on non-darwin.
    expect(source).toMatch(
      /if \(prewarmed \|\| process\.platform !== 'darwin'\) \{\s*\n?\s*return\s*\n?\s*\}/,
    )
  })

  test('prewarmed flag set to true BEFORE require (re-entrancy guard)', () => {
    // Pin: set flag before loading. A regression that flips order
    // would allow a second concurrent call to also try loading.
    expect(source).toMatch(
      /prewarmed = true\s*\n?\s*\/\/[^\n]+\n\s*try \{/,
    )
  })

  test('prewarm catches load errors silently (no crash on missing native)', () => {
    expect(source).toMatch(
      /} catch \{\s*\n?\s*\/\/ Ignore errors during prewarm\s*\n?\s*\}/,
    )
  })

  test('isModifierPressed uses dynamic require, NOT top-level import', () => {
    // Pin: dynamic require defers loading until first call.
    // A top-level `import { isModifierPressed as ... } from 'modifiers-napi'`
    // would load native ffi on every startup.
    expect(source).toMatch(
      /const \{ isModifierPressed: nativeIsModifierPressed \} =\s*\n?\s*\/\/[\s\S]*?require\('modifiers-napi'\)/,
    )
  })

  test('isModifierPressed returns false IMMEDIATELY on non-darwin', () => {
    // Pin: early-return before any module load attempt.
    expect(source).toMatch(
      /isModifierPressed\(modifier: ModifierKey\): boolean \{\s*\n?\s*if \(process\.platform !== 'darwin'\) \{\s*\n?\s*return false/,
    )
  })

  test('require typed cast to { isModifierPressed: (m: string) => boolean }', () => {
    // Pin: the cast keeps the unknown require result typed for the
    // call below.
    expect(source).toMatch(
      /\{ isModifierPressed: \(m: string\) => boolean \}/,
    )
  })

  test('no top-level import of modifiers-napi (lazy-load discipline)', () => {
    // Pin: NEVER add a top-level `import ... from 'modifiers-napi'`.
    expect(source).not.toMatch(
      /^import [\s\S]+? from ['"]modifiers-napi['"]/m,
    )
  })

  test('prewarm calls .prewarm() from the native module (NOT a noop wrapper)', () => {
    expect(source).toMatch(
      /const \{ prewarm \} = require\('modifiers-napi'\)[\s\S]+?prewarm\(\)/,
    )
  })
})
