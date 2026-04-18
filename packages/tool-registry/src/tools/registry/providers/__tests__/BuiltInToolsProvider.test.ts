import { describe, expect, test } from 'bun:test'
import { BuiltInToolsProvider } from '../BuiltInToolsProvider.js'

describe('BuiltInToolsProvider', () => {
  test('discovers a non-empty set of tools', () => {
    const tools = BuiltInToolsProvider.discover()
    expect(tools.length).toBeGreaterThan(0)
  })

  test('all tool names are unique', () => {
    const tools = BuiltInToolsProvider.discover()
    const names = tools.map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test('always includes core tools', () => {
    const tools = BuiltInToolsProvider.discover()
    const names = new Set(tools.map(t => t.name))
    // Core tools that are statically imported and always present
    expect(names.has('Bash')).toBe(true)
    expect(names.has('Read')).toBe(true)
    expect(names.has('Edit')).toBe(true)
    expect(names.has('Write')).toBe(true)
  })

  test('every tool has required methods', () => {
    const tools = BuiltInToolsProvider.discover()
    for (const tool of tools) {
      // Some tools may be conditionally loaded and could be undefined in test isolation
      if (!tool || typeof tool.name !== 'string') continue
      expect(typeof tool.call).toBe('function')
      expect(typeof tool.description).toBe('function')
      expect(typeof tool.isEnabled).toBe('function')
      expect(typeof tool.isReadOnly).toBe('function')
      expect(typeof tool.checkPermissions).toBe('function')
      expect(typeof tool.prompt).toBe('function')
      expect(typeof tool.mapToolResultToToolResultBlockParam).toBe('function')
    }
  })

  test('produces consistent results across multiple calls', () => {
    const first = BuiltInToolsProvider.discover()
    const second = BuiltInToolsProvider.discover()
    expect(first.map(t => t.name)).toEqual(second.map(t => t.name))
  })
})
