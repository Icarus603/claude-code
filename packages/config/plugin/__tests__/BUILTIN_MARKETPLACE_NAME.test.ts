import { describe, expect, test } from 'bun:test'
import { BUILTIN_MARKETPLACE_NAME as fromDeps } from '../_deps.js'
import { BUILTIN_MARKETPLACE_NAME as fromBuiltin } from '../builtin.js'
import { parsePluginIdentifier } from '../pluginIdentifier.js'

// V9-2.8 regression: a hand-typed copy at _deps.ts:635 said 'anthropics'
// while the real source-of-truth at builtin.ts:23 said 'builtin'. Built-in
// plugin IDs use the format `name@builtin` (per the comment in builtin.ts
// and the `endsWith(`@${BUILTIN_MARKETPLACE_NAME}`)` check at builtin.ts:38).
// pluginLoader.ts:1913 imports BUILTIN_MARKETPLACE_NAME from _deps.js to
// filter out built-in plugins from the marketplace-plugin loading path:
//
//   return marketplace !== BUILTIN_MARKETPLACE_NAME
//
// With the wrong copy ('anthropics'), the filter never matched for the
// actual built-in plugin marketplace ('builtin'), so built-in plugins
// were processed as if they were marketplace plugins and the marketplace
// loader would fail to find a marketplace named 'builtin'.
//
// Fix: _deps.ts now `export { BUILTIN_MARKETPLACE_NAME } from './builtin.js'`.
// This test pins the contract that imports from _deps and from builtin
// resolve to the SAME value.

describe('BUILTIN_MARKETPLACE_NAME re-exported from _deps', () => {
  test('is the literal string "builtin"', () => {
    expect(fromBuiltin).toBe('builtin')
  })

  test('_deps re-export resolves to the same value as the canonical', () => {
    expect(fromDeps).toBe(fromBuiltin)
    expect(fromDeps).toBe('builtin')
  })

  test('matches the plugin-id suffix convention `name@builtin`', () => {
    // builtin.ts:38 builds plugin IDs as `name@${BUILTIN_MARKETPLACE_NAME}`.
    // The marketplace component returned by parsePluginIdentifier on
    // `foo@builtin` must equal BUILTIN_MARKETPLACE_NAME exactly.
    const sampleId = `foo@${fromDeps}`
    expect(sampleId).toBe('foo@builtin')
    // Equivalent: pluginLoader's filter expression
    //   marketplace !== BUILTIN_MARKETPLACE_NAME
    // must return false (skip) when marketplace is 'builtin'.
    const marketplace = 'builtin'
    expect(marketplace !== fromDeps).toBe(false)
  })

  test('parsePluginIdentifier round-trip: built-in plugin id is filtered by pluginLoader', () => {
    // This pins the EXACT pluginLoader.ts:1906-1914 filter behavior.
    // Before V9-2.8, _deps was 'anthropics' but real plugin IDs are
    // 'name@builtin', so the filter produced true (don't skip) for every
    // built-in plugin → built-ins were processed as marketplace plugins
    // and ended up duplicated in the merge stream
    // (mergePluginSources just concatenates marketplace + builtin without
    // dedup-by-name).
    //
    // After fix: filter must return FALSE (skip / handled separately) for
    // any plugin id of the form `name@builtin`.
    const builtinId = 'foo@builtin'
    const { marketplace } = parsePluginIdentifier(builtinId)
    expect(marketplace).toBe('builtin')
    // The key invariant: pluginLoader's filter `marketplace !== fromDeps`
    // should be false for built-in plugins, so they're SKIPPED from the
    // marketplace-loading branch.
    expect(marketplace !== fromDeps).toBe(false)

    // Conversely, a real marketplace plugin should NOT be filtered out
    // (filter returns true, plugin enters marketplace pipeline).
    const realId = 'foo@anthropics'
    const realParsed = parsePluginIdentifier(realId)
    expect(realParsed.marketplace !== fromDeps).toBe(true)
  })
})
