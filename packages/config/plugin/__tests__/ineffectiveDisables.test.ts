/**
 * Tests for `detectIneffectiveDisables` / `formatIneffectiveDisable`
 * — port-correctness against ant v2.1.136 `p8K` + `yE8` + `W33`
 * (4203.js m8K module).
 *
 * The detection function depends on global settings state. We mock
 * the layered-settings reader directly via `mock.module` so tests
 * are deterministic. Per memory `bun mock.module is GLOBAL across
 * the test run` — mocks here only override what we install.
 */
import { describe, expect, mock, test, beforeEach } from 'bun:test'

type EnabledMap = Record<string, boolean | undefined>
type LayerName =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'flagSettings'
  | 'policySettings'

const layers: Partial<Record<LayerName, EnabledMap | undefined>> = {}
let enabledSources: LayerName[] = []

mock.module('../../settings/settings.js', () => ({
  getSettings() {
    return {}
  },
  getSettingsForSource(src: LayerName) {
    if (!(src in layers)) return null
    const ep = layers[src]
    return ep ? { enabledPlugins: ep } : null
  },
}))

mock.module('../../settings/constants.js', () => ({
  getEnabledSettingSources() {
    return enabledSources
  },
}))

const {
  detectIneffectiveDisables,
  formatIneffectiveDisable,
} = await import('../ineffectiveDisables.js')

beforeEach(() => {
  for (const k of Object.keys(layers)) delete layers[k as LayerName]
  enabledSources = [
    'userSettings',
    'projectSettings',
    'localSettings',
    'flagSettings',
    'policySettings',
  ]
})

describe('detectIneffectiveDisables (ant p8K)', () => {
  test('returns [] when userSettings not in enabled sources', () => {
    enabledSources = ['projectSettings', 'localSettings']
    layers.userSettings = { foo: false }
    layers.projectSettings = { foo: true }
    expect(detectIneffectiveDisables()).toEqual([])
  })

  test('returns [] when userSettings has no enabledPlugins map', () => {
    layers.userSettings = undefined
    layers.projectSettings = { foo: true }
    expect(detectIneffectiveDisables()).toEqual([])
  })

  test('returns [] when user has no false entries (only true)', () => {
    layers.userSettings = { foo: true, bar: true }
    layers.projectSettings = { foo: true }
    expect(detectIneffectiveDisables()).toEqual([])
  })

  test('flags overrider when single higher-precedence layer enables it', () => {
    layers.userSettings = { foo: false }
    layers.projectSettings = { foo: true }
    expect(detectIneffectiveDisables()).toEqual([
      { pluginId: 'foo', overriddenBy: 'projectSettings' },
    ])
  })

  test('LATER disabling layer resets the override (ant: A = $ === !1 ? null : z)', () => {
    // project=true, local=false → local re-disables, no override.
    // ant's walk: project sets A='projectSettings', local sets A=null.
    layers.userSettings = { foo: false }
    layers.projectSettings = { foo: true }
    layers.localSettings = { foo: false }
    expect(detectIneffectiveDisables()).toEqual([])
  })

  test('LATER enabling layer replaces overriddenBy (last enabling wins)', () => {
    // project=true, local=true → walk overwrites A='localSettings'.
    layers.userSettings = { foo: false }
    layers.projectSettings = { foo: true }
    layers.localSettings = { foo: true }
    expect(detectIneffectiveDisables()).toEqual([
      { pluginId: 'foo', overriddenBy: 'localSettings' },
    ])
  })

  test('layer with undefined value is skipped (does not affect override)', () => {
    layers.userSettings = { foo: false }
    layers.projectSettings = { foo: true }
    layers.flagSettings = {} // no `foo` entry — should not reset
    layers.policySettings = {} // ditto
    expect(detectIneffectiveDisables()).toEqual([
      { pluginId: 'foo', overriddenBy: 'projectSettings' },
    ])
  })

  test('multiple disabled plugins each evaluated independently', () => {
    layers.userSettings = { a: false, b: false, c: false }
    layers.projectSettings = { a: true } // a → flagged
    layers.localSettings = { b: false } // b → re-disabled, NOT flagged
    layers.flagSettings = { c: true } // c → flagged via flag
    const result = detectIneffectiveDisables()
    expect(result).toEqual([
      { pluginId: 'a', overriddenBy: 'projectSettings' },
      { pluginId: 'c', overriddenBy: 'flagSettings' },
    ])
  })

  test('policy layer can override (highest precedence)', () => {
    layers.userSettings = { foo: false }
    layers.policySettings = { foo: true }
    expect(detectIneffectiveDisables()).toEqual([
      { pluginId: 'foo', overriddenBy: 'policySettings' },
    ])
  })

  test('respects enabledSources order — local excluded means local-disable does NOT reset', () => {
    // Remove localSettings from the enabled chain. ant `yR()` only
    // returns allowed sources, and `p8K` only walks those — so a
    // local=false in this case is invisible and project=true wins.
    enabledSources = [
      'userSettings',
      'projectSettings',
      'flagSettings',
      'policySettings',
    ]
    layers.userSettings = { foo: false }
    layers.projectSettings = { foo: true }
    layers.localSettings = { foo: false } // ignored because not in enabledSources
    expect(detectIneffectiveDisables()).toEqual([
      { pluginId: 'foo', overriddenBy: 'projectSettings' },
    ])
  })
})

describe('formatIneffectiveDisable (ant yE8 + W33)', () => {
  test('projectSettings → "project" + advice', () => {
    const msg = formatIneffectiveDisable({
      pluginId: 'foo',
      overriddenBy: 'projectSettings',
    })
    expect(msg).toContain(
      '"foo" is enabled by project settings, which override your user setting.',
    )
    expect(msg).toContain(
      'To opt out, set "enabledPlugins": {"foo": false} in .claude/settings.local.json.',
    )
  })

  test('localSettings → "project, gitignored" + advice', () => {
    const msg = formatIneffectiveDisable({
      pluginId: 'bar',
      overriddenBy: 'localSettings',
    })
    expect(msg).toContain(
      '"bar" is enabled by project, gitignored settings, which override your user setting.',
    )
    expect(msg).toContain(
      'To opt out, change it to false in .claude/settings.local.json (that file currently enables it).',
    )
  })

  test('flagSettings → "cli flag" + remove-from-flag advice', () => {
    const msg = formatIneffectiveDisable({
      pluginId: 'baz',
      overriddenBy: 'flagSettings',
    })
    expect(msg).toContain(
      '"baz" is enabled by cli flag settings, which override your user setting.',
    )
    expect(msg).toContain(
      'This comes from the --settings flag; .claude/settings.local.json won\'t override it. Remove "baz" from the --settings value.',
    )
  })

  test('policySettings → "managed" + admin contact advice', () => {
    const msg = formatIneffectiveDisable({
      pluginId: 'qux',
      overriddenBy: 'policySettings',
    })
    expect(msg).toContain(
      '"qux" is enabled by managed settings, which override your user setting.',
    )
    expect(msg).toContain(
      "Managed policy can't be overridden locally — contact your administrator.",
    )
  })
})
