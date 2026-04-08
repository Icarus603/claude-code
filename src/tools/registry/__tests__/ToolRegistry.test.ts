import { describe, expect, test, beforeEach } from 'bun:test'
import type { Tool, Tools } from '../../../Tool.js'
import { buildTool } from '../../../Tool.js'
import { ToolRegistry } from '../ToolRegistry.js'
import type { ToolProvider } from '../types.js'

// Helper: create a minimal tool for testing
function makeTool(name: string, opts?: { aliases?: string[]; isEnabled?: () => boolean }): Tool {
  return buildTool({
    name,
    aliases: opts?.aliases,
    isEnabled: opts?.isEnabled ?? (() => true),
    call: async () => ({ data: `${name}-result` }),
    description: async () => `${name} description`,
    inputSchema: {} as any,
    isReadOnly: () => false,
    prompt: async () => '',
    userFacingName: () => name,
    mapToolResultToToolResultBlockParam: (content, id) => ({
      type: 'tool_result',
      tool_use_id: id,
      content: String(content),
    }),
    toAutoClassifierInput: () => '',
  })
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
  })

  describe('register / unregister', () => {
    test('register and get a tool', () => {
      const tool = makeTool('BashTool')
      registry.register(tool, 'builtin', 'test')
      expect(registry.get('BashTool')).toBe(tool)
    })

    test('register overwrites existing tool', () => {
      const tool1 = makeTool('BashTool')
      const tool2 = makeTool('BashTool')
      registry.register(tool1, 'builtin', 'test')
      registry.register(tool2, 'builtin', 'test')
      expect(registry.get('BashTool')).toBe(tool2)
    })

    test('unregister removes tool', () => {
      const tool = makeTool('BashTool')
      registry.register(tool, 'builtin', 'test')
      expect(registry.unregister('BashTool')).toBe(true)
      expect(registry.get('BashTool')).toBeUndefined()
    })

    test('unregister returns false for unknown tool', () => {
      expect(registry.unregister('nonexistent')).toBe(false)
    })

    test('size tracks registered tools', () => {
      expect(registry.size).toBe(0)
      registry.register(makeTool('A'), 'builtin', 'test')
      registry.register(makeTool('B'), 'builtin', 'test')
      expect(registry.size).toBe(2)
      registry.unregister('A')
      expect(registry.size).toBe(1)
    })
  })

  describe('alias lookup', () => {
    test('find tool by alias', () => {
      const tool = makeTool('FileReadTool', { aliases: ['read', 'cat'] })
      registry.register(tool, 'builtin', 'test')
      expect(registry.get('read')).toBe(tool)
      expect(registry.get('cat')).toBe(tool)
    })

    test('alias index cleaned on unregister', () => {
      const tool = makeTool('Tool', { aliases: ['alias1'] })
      registry.register(tool, 'builtin', 'test')
      expect(registry.get('alias1')).toBe(tool)
      registry.unregister('Tool')
      expect(registry.get('alias1')).toBeUndefined()
    })
  })

  describe('getAll / getByCategory / getRegistration', () => {
    test('getAll returns all tools', () => {
      const a = makeTool('A')
      const b = makeTool('B')
      registry.register(a, 'builtin', 'p1')
      registry.register(b, 'mcp', 'p2')
      const all = registry.getAll()
      expect(all).toHaveLength(2)
      expect(all).toContain(a)
      expect(all).toContain(b)
    })

    test('getByCategory filters', () => {
      registry.register(makeTool('A'), 'builtin', 'p1')
      registry.register(makeTool('B'), 'mcp', 'p2')
      registry.register(makeTool('C'), 'builtin', 'p1')
      expect(registry.getByCategory('builtin')).toHaveLength(2)
      expect(registry.getByCategory('mcp')).toHaveLength(1)
    })

    test('getRegistration returns metadata', () => {
      const tool = makeTool('A')
      registry.register(tool, 'builtin', 'myProvider')
      const reg = registry.getRegistration('A')!
      expect(reg.category).toBe('builtin')
      expect(reg.providerName).toBe('myProvider')
      expect(reg.tool).toBe(tool)
    })
  })

  describe('has', () => {
    test('returns true for registered name', () => {
      registry.register(makeTool('A'), 'builtin', 'test')
      expect(registry.has('A')).toBe(true)
    })

    test('returns true for alias', () => {
      registry.register(makeTool('A', { aliases: ['alpha'] }), 'builtin', 'test')
      expect(registry.has('alpha')).toBe(true)
    })

    test('returns false for unknown', () => {
      expect(registry.has('nope')).toBe(false)
    })
  })

  describe('registerProvider', () => {
    test('registers all tools from a provider', async () => {
      const provider: ToolProvider = {
        name: 'test-provider',
        discover: () => [makeTool('X'), makeTool('Y')],
      }
      await registry.registerProvider(provider)
      expect(registry.get('X')).toBeDefined()
      expect(registry.get('Y')).toBeDefined()
      expect(registry.size).toBe(2)
    })

    test('supports async discover', async () => {
      const provider: ToolProvider = {
        name: 'async-provider',
        discover: async () => {
          await new Promise(r => setTimeout(r, 1))
          return [makeTool('AsyncTool')]
        },
      }
      await registry.registerProvider(provider)
      expect(registry.get('AsyncTool')).toBeDefined()
    })
  })

  describe('events', () => {
    test('onRegister called on register', () => {
      const registered: string[] = []
      const reg = new ToolRegistry({
        onRegister: r => registered.push(r.tool.name),
      })
      reg.register(makeTool('A'), 'builtin', 'test')
      expect(registered).toEqual(['A'])
    })

    test('onUnregister called on unregister', () => {
      const unregistered: string[] = []
      const reg = new ToolRegistry({
        onUnregister: name => unregistered.push(name),
      })
      reg.register(makeTool('A'), 'builtin', 'test')
      reg.unregister('A')
      expect(unregistered).toEqual(['A'])
    })
  })

  describe('getEnabledTools', () => {
    test('filters out disabled tools', () => {
      registry.register(makeTool('Enabled'), 'builtin', 'test')
      registry.register(makeTool('Disabled', { isEnabled: () => false }), 'builtin', 'test')
      const emptyPermCtx = {
        mode: 'default' as const,
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: false,
      }
      const enabled = registry.getEnabledTools(emptyPermCtx)
      expect(enabled.map(t => t.name)).toEqual(['Enabled'])
    })
  })

  describe('assemblePool', () => {
    const emptyPermCtx = {
      mode: 'default' as const,
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
    }

    test('merges builtin + MCP sorted by name', () => {
      registry.register(makeTool('Zebra'), 'builtin', 'test')
      registry.register(makeTool('Alpha'), 'builtin', 'test')
      const mcpTools = [makeTool('mcp__server__Beta'), makeTool('mcp__server__Gamma')]

      const pool = registry.assemblePool(emptyPermCtx, mcpTools)
      const names = pool.map(t => t.name)

      // Builtins first (sorted), then MCP (sorted)
      expect(names).toEqual(['Alpha', 'Zebra', 'mcp__server__Beta', 'mcp__server__Gamma'])
    })

    test('builtins win on name conflict', () => {
      registry.register(makeTool('Shared'), 'builtin', 'test')
      const mcpTools = [makeTool('Shared')]

      const pool = registry.assemblePool(emptyPermCtx, mcpTools)
      expect(pool).toHaveLength(1)
      // Should be the builtin version
      expect(registry.getRegistration('Shared')!.category).toBe('builtin')
    })
  })

  describe('clear', () => {
    test('removes everything', () => {
      registry.register(makeTool('A'), 'builtin', 'test')
      registry.register(makeTool('B'), 'mcp', 'test')
      registry.clear()
      expect(registry.size).toBe(0)
      expect(registry.getAll()).toHaveLength(0)
    })
  })

  describe('findIn (static)', () => {
    test('finds tool by name in array', () => {
      const tools: Tools = [makeTool('A'), makeTool('B')]
      expect(ToolRegistry.findIn(tools, 'B')!.name).toBe('B')
    })

    test('returns undefined for missing', () => {
      expect(ToolRegistry.findIn([], 'X')).toBeUndefined()
    })
  })
})
