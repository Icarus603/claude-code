import { describe, expect, test } from 'bun:test'
import { parsePluginArgs } from '../commands/plugin/parseArgs.js'

describe('parsePluginArgs — empty / undefined args', () => {
  test('undefined → menu', () => {
    expect(parsePluginArgs()).toEqual({ type: 'menu' })
  })

  test('empty string → menu', () => {
    expect(parsePluginArgs('')).toEqual({ type: 'menu' })
  })

  test('whitespace-only → menu', () => {
    // The function checks `!args` → empty becomes menu. Whitespace-only
    // hits the trim+split path with empty parts[0], which falls through
    // to the default → menu.
    expect(parsePluginArgs('   ')).toEqual({ type: 'menu' })
  })
})

describe('parsePluginArgs — help', () => {
  test('"help" → help', () => {
    expect(parsePluginArgs('help')).toEqual({ type: 'help' })
  })

  test('"--help" → help', () => {
    expect(parsePluginArgs('--help')).toEqual({ type: 'help' })
  })

  test('"-h" → help', () => {
    expect(parsePluginArgs('-h')).toEqual({ type: 'help' })
  })

  test('case-insensitive: "HELP" → help', () => {
    expect(parsePluginArgs('HELP')).toEqual({ type: 'help' })
  })

  test('"help arg" → help (extra args ignored)', () => {
    expect(parsePluginArgs('help anything else')).toEqual({ type: 'help' })
  })
})

describe('parsePluginArgs — install', () => {
  test('"install" alone → install with no plugin/marketplace', () => {
    expect(parsePluginArgs('install')).toEqual({ type: 'install' })
  })

  test('"i" alias → install', () => {
    expect(parsePluginArgs('i')).toEqual({ type: 'install' })
  })

  test('"install plugin@marketplace" → split on @', () => {
    expect(parsePluginArgs('install foo@bar')).toEqual({
      type: 'install',
      plugin: 'foo',
      marketplace: 'bar',
    })
  })

  test('"install https://example.com" → marketplace URL', () => {
    expect(parsePluginArgs('install https://example.com/repo')).toEqual({
      type: 'install',
      marketplace: 'https://example.com/repo',
    })
  })

  test('"install http://example.com" → marketplace URL', () => {
    expect(parsePluginArgs('install http://example.com')).toEqual({
      type: 'install',
      marketplace: 'http://example.com',
    })
  })

  test('"install file:///path" → marketplace URL', () => {
    expect(parsePluginArgs('install file:///path/to/repo')).toEqual({
      type: 'install',
      marketplace: 'file:///path/to/repo',
    })
  })

  test('"install /absolute/path" → marketplace path', () => {
    // Path-with-/ heuristic: anything containing / is a marketplace.
    expect(parsePluginArgs('install /local/path')).toEqual({
      type: 'install',
      marketplace: '/local/path',
    })
  })

  test('"install C:\\\\path" → marketplace path (Windows)', () => {
    expect(parsePluginArgs('install C:\\Users\\me')).toEqual({
      type: 'install',
      marketplace: 'C:\\Users\\me',
    })
  })

  test('"install plain-name" → plugin name (no /, no @)', () => {
    expect(parsePluginArgs('install my-plugin')).toEqual({
      type: 'install',
      plugin: 'my-plugin',
    })
  })

  test('"install i" alias works', () => {
    expect(parsePluginArgs('i my-plugin')).toEqual({
      type: 'install',
      plugin: 'my-plugin',
    })
  })

  test('"install foo@" (empty marketplace) — split puts undefined in marketplace', () => {
    // 'foo@'.split('@') = ['foo', ''] → plugin='foo', marketplace=''
    const result = parsePluginArgs('install foo@')
    expect(result).toEqual({
      type: 'install',
      plugin: 'foo',
      marketplace: '',
    })
  })
})

describe('parsePluginArgs — manage / uninstall / enable / disable', () => {
  test('"manage" → manage', () => {
    expect(parsePluginArgs('manage')).toEqual({ type: 'manage' })
  })

  test('"uninstall plugin-name"', () => {
    expect(parsePluginArgs('uninstall my-plugin')).toEqual({
      type: 'uninstall',
      plugin: 'my-plugin',
    })
  })

  test('"uninstall" with no plugin → undefined plugin', () => {
    expect(parsePluginArgs('uninstall')).toEqual({
      type: 'uninstall',
      plugin: undefined,
    })
  })

  test('"enable plugin-name"', () => {
    expect(parsePluginArgs('enable foo')).toEqual({
      type: 'enable',
      plugin: 'foo',
    })
  })

  test('"disable plugin-name"', () => {
    expect(parsePluginArgs('disable bar')).toEqual({
      type: 'disable',
      plugin: 'bar',
    })
  })
})

describe('parsePluginArgs — validate', () => {
  test('"validate /path/to/plugin"', () => {
    expect(parsePluginArgs('validate /path/to/plugin')).toEqual({
      type: 'validate',
      path: '/path/to/plugin',
    })
  })

  test('"validate" alone → undefined path', () => {
    expect(parsePluginArgs('validate')).toEqual({
      type: 'validate',
      path: undefined,
    })
  })

  test('"validate" with multi-word path joins with spaces', () => {
    // path is parts.slice(1).join(' ').trim()
    expect(parsePluginArgs('validate /my path/to/plugin')).toEqual({
      type: 'validate',
      path: '/my path/to/plugin',
    })
  })
})

describe('parsePluginArgs — marketplace subcommands', () => {
  test('"marketplace add my/repo"', () => {
    expect(parsePluginArgs('marketplace add my/repo')).toEqual({
      type: 'marketplace',
      action: 'add',
      target: 'my/repo',
    })
  })

  test('"market" alias works', () => {
    expect(parsePluginArgs('market add my/repo')).toEqual({
      type: 'marketplace',
      action: 'add',
      target: 'my/repo',
    })
  })

  test('"marketplace remove name"', () => {
    expect(parsePluginArgs('marketplace remove my-mp')).toEqual({
      type: 'marketplace',
      action: 'remove',
      target: 'my-mp',
    })
  })

  test('"marketplace rm name" (alias for remove)', () => {
    expect(parsePluginArgs('marketplace rm my-mp')).toEqual({
      type: 'marketplace',
      action: 'remove',
      target: 'my-mp',
    })
  })

  test('"marketplace update"', () => {
    expect(parsePluginArgs('marketplace update name')).toEqual({
      type: 'marketplace',
      action: 'update',
      target: 'name',
    })
  })

  test('"marketplace list" → no target', () => {
    expect(parsePluginArgs('marketplace list')).toEqual({
      type: 'marketplace',
      action: 'list',
    })
  })

  test('"marketplace" alone → undefined action (menu)', () => {
    expect(parsePluginArgs('marketplace')).toEqual({ type: 'marketplace' })
  })

  test('"marketplace unknown-action" → marketplace menu (no action)', () => {
    expect(parsePluginArgs('marketplace foo bar')).toEqual({
      type: 'marketplace',
    })
  })

  test('marketplace subcommand action is case-insensitive', () => {
    expect(parsePluginArgs('marketplace ADD foo')).toEqual({
      type: 'marketplace',
      action: 'add',
      target: 'foo',
    })
  })
})

describe('parsePluginArgs — unknown command falls through to menu', () => {
  test('unknown verb → menu', () => {
    expect(parsePluginArgs('foobar baz')).toEqual({ type: 'menu' })
  })
})

describe('parsePluginArgs — case sensitivity', () => {
  test('command lookup is case-insensitive', () => {
    expect(parsePluginArgs('INSTALL my-plugin')).toEqual({
      type: 'install',
      plugin: 'my-plugin',
    })
  })

  test('plugin name itself is case-PRESERVING', () => {
    // The plugin/marketplace argument is NOT lowercased.
    expect(parsePluginArgs('install MyPlugin')).toEqual({
      type: 'install',
      plugin: 'MyPlugin',
    })
  })
})

describe('parsePluginArgs — whitespace handling', () => {
  test('multiple spaces between args treated as single separator', () => {
    // .split(/\s+/) collapses runs of whitespace.
    expect(parsePluginArgs('install   foo')).toEqual({
      type: 'install',
      plugin: 'foo',
    })
  })

  test('tab-separated args work', () => {
    expect(parsePluginArgs('install\tfoo')).toEqual({
      type: 'install',
      plugin: 'foo',
    })
  })

  test('leading whitespace trimmed', () => {
    expect(parsePluginArgs('   install foo')).toEqual({
      type: 'install',
      plugin: 'foo',
    })
  })
})
