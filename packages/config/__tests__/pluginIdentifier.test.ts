import { describe, expect, test } from 'bun:test'
import {
  buildPluginId,
  isOfficialMarketplaceName,
  parsePluginIdentifier,
  scopeToSettingSource,
  settingSourceToScope,
} from '../plugin/pluginIdentifier.js'

describe('parsePluginIdentifier', () => {
  test('plugin name only → name without marketplace', () => {
    expect(parsePluginIdentifier('foo')).toEqual({ name: 'foo' })
  })

  test('plugin@marketplace → split on first @', () => {
    expect(parsePluginIdentifier('foo@bar')).toEqual({
      name: 'foo',
      marketplace: 'bar',
    })
  })

  test('multiple @ — only first split (rest absorbed/ignored)', () => {
    // Documented: 'plugin@market@place' → name='plugin', marketplace='market'.
    // Anything after second @ is silently dropped because parts[1] takes
    // only the second segment.
    expect(parsePluginIdentifier('plugin@market@place')).toEqual({
      name: 'plugin',
      marketplace: 'market',
    })
  })

  test('empty plugin name with @ → name="" (parts[0] || "")', () => {
    // '@market' → split = ['', 'market']. The `|| ''` keeps name empty.
    expect(parsePluginIdentifier('@market')).toEqual({
      name: '',
      marketplace: 'market',
    })
  })

  test('plugin@ (trailing @) → empty marketplace string', () => {
    // 'foo@' → split = ['foo', '']. marketplace is empty string, NOT
    // undefined. Documents this — caller distinguishing "no marketplace"
    // vs "empty marketplace" must check truthy explicitly.
    expect(parsePluginIdentifier('foo@')).toEqual({
      name: 'foo',
      marketplace: '',
    })
  })

  test('empty string → empty name', () => {
    expect(parsePluginIdentifier('')).toEqual({ name: '' })
  })

  test('only @ → empty name + empty marketplace', () => {
    expect(parsePluginIdentifier('@')).toEqual({
      name: '',
      marketplace: '',
    })
  })

  test('hyphenated names work', () => {
    expect(parsePluginIdentifier('my-plugin@my-market')).toEqual({
      name: 'my-plugin',
      marketplace: 'my-market',
    })
  })

  test('underscore + dot in name preserved', () => {
    expect(parsePluginIdentifier('my_plugin.v2@market')).toEqual({
      name: 'my_plugin.v2',
      marketplace: 'market',
    })
  })
})

describe('buildPluginId — inverse of parsePluginIdentifier', () => {
  test('without marketplace → just name', () => {
    expect(buildPluginId('foo')).toBe('foo')
  })

  test('with marketplace → name@marketplace', () => {
    expect(buildPluginId('foo', 'bar')).toBe('foo@bar')
  })

  test('undefined marketplace → just name', () => {
    expect(buildPluginId('foo', undefined)).toBe('foo')
  })

  test('empty string marketplace → just name (treated as missing via ternary)', () => {
    // CRITICAL: the function uses `marketplace ? "name@marketplace" : name`.
    // Empty string is falsy → drops the @ separator. This means
    // parsePluginIdentifier('foo@') → buildPluginId('foo', '') → 'foo' is
    // NOT a round-trip identity. Document this.
    expect(buildPluginId('foo', '')).toBe('foo')
  })

  test('round-trip: parse → build (canonical case)', () => {
    expect(buildPluginId('a', 'b')).toBe('a@b')
    const p = parsePluginIdentifier('a@b')
    expect(buildPluginId(p.name, p.marketplace)).toBe('a@b')
  })

  test('round-trip with empty marketplace — string gets normalized', () => {
    // 'foo@' → parse → {name: 'foo', marketplace: ''} → build → 'foo'.
    // The empty marketplace gets dropped on rebuild. Document the
    // asymmetry.
    const p = parsePluginIdentifier('foo@')
    expect(buildPluginId(p.name, p.marketplace)).toBe('foo')
  })
})

describe('isOfficialMarketplaceName — security boundary', () => {
  // CRITICAL: this gate determines whether marketplace names go to general
  // analytics (safe — opensource Anthropic-controlled names) or PII-tagged
  // BQ columns (third-party names, possibly identifying). A leak here
  // would put third-party names into general analytics by mistake.

  test('undefined → false (no-marketplace plugins)', () => {
    expect(isOfficialMarketplaceName(undefined)).toBe(false)
  })

  test('empty string → false', () => {
    expect(isOfficialMarketplaceName('')).toBe(false)
  })

  test('claude-code-marketplace → true', () => {
    expect(isOfficialMarketplaceName('claude-code-marketplace')).toBe(true)
  })

  test('claude-code-plugins → true', () => {
    expect(isOfficialMarketplaceName('claude-code-plugins')).toBe(true)
  })

  test('claude-plugins-official → true', () => {
    expect(isOfficialMarketplaceName('claude-plugins-official')).toBe(true)
  })

  test('anthropic-marketplace → true', () => {
    expect(isOfficialMarketplaceName('anthropic-marketplace')).toBe(true)
  })

  test('anthropic-plugins → true', () => {
    expect(isOfficialMarketplaceName('anthropic-plugins')).toBe(true)
  })

  test('agent-skills → true', () => {
    expect(isOfficialMarketplaceName('agent-skills')).toBe(true)
  })

  test('case-insensitive matching (CLAUDE-CODE-PLUGINS → true)', () => {
    // The check uses `.toLowerCase()`. Verify upstream/uppercase variants.
    expect(isOfficialMarketplaceName('CLAUDE-CODE-PLUGINS')).toBe(true)
  })

  test('mixed case accepted', () => {
    expect(isOfficialMarketplaceName('Claude-Code-Plugins')).toBe(true)
  })

  test('third-party name → false (security boundary)', () => {
    expect(isOfficialMarketplaceName('third-party-marketplace')).toBe(false)
  })

  test('typo of official name → false', () => {
    // CRITICAL: a near-miss like 'antrhopic-marketplace' (typo) MUST
    // still be classified as third-party. The Set membership check is
    // exact (after lowercase) — no fuzzy match.
    expect(isOfficialMarketplaceName('antrhopic-marketplace')).toBe(false)
  })

  test('substring of official name → false', () => {
    expect(isOfficialMarketplaceName('claude-code')).toBe(false)
  })

  test('superstring of official name → false', () => {
    expect(isOfficialMarketplaceName('claude-code-marketplace-fake')).toBe(false)
  })

  test('whitespace-padded official name → false (no trim)', () => {
    // Documents: the function does NOT trim. ' claude-code-plugins ' is
    // NOT recognized as official.
    expect(isOfficialMarketplaceName(' claude-code-plugins ')).toBe(false)
  })
})

describe('scopeToSettingSource — install scope routing', () => {
  test('user → userSettings', () => {
    expect(scopeToSettingSource('user')).toBe('userSettings')
  })

  test('project → projectSettings', () => {
    expect(scopeToSettingSource('project')).toBe('projectSettings')
  })

  test('local → localSettings', () => {
    expect(scopeToSettingSource('local')).toBe('localSettings')
  })

  test('managed scope throws (cannot install)', () => {
    // CRITICAL: managed scope is policy-pushed by the IT admin and is
    // read-only at the CLI level. Throwing here prevents install paths
    // from accidentally writing to it.
    expect(() => scopeToSettingSource('managed')).toThrow(
      /Cannot install plugins to managed scope/,
    )
  })
})

describe('settingSourceToScope — inverse of scopeToSettingSource', () => {
  test('userSettings → user', () => {
    expect(settingSourceToScope('userSettings')).toBe('user')
  })

  test('projectSettings → project', () => {
    expect(settingSourceToScope('projectSettings')).toBe('project')
  })

  test('localSettings → local', () => {
    expect(settingSourceToScope('localSettings')).toBe('local')
  })

  test('flagSettings → flag (session-only, NOT persisted)', () => {
    // 'flag' scope is session-only — it's the --plugin-dir CLI flag.
    // Persistence layer must filter this out before writing
    // installed_plugins.json. Documents the existence of this fourth
    // scope value.
    expect(settingSourceToScope('flagSettings' as never)).toBe('flag')
  })
})
