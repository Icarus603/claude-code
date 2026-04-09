import { beforeEach, describe, expect, test } from 'bun:test'
import type { ToolLike } from '../contracts.js'
import {
  __resetToolRegistryForTests,
  assembleToolPool,
  filterToolsByDenyRules,
  getAllBaseTools,
  getTools,
  installToolRegistryHostBindings,
} from '../index.js'

type TestPermissionContext = {
  denied?: Set<string>
}

function makeTool(name: string, enabled = true): ToolLike {
  return {
    name,
    isEnabled: () => enabled,
  }
}

describe('@claude-code/tool-registry integration', () => {
  beforeEach(() => {
    __resetToolRegistryForTests()
    installToolRegistryHostBindings({
      discoverBuiltInTools: () => [
        makeTool('Alpha'),
        makeTool('Bravo'),
        makeTool('Disabled', false),
      ],
      getDenyRuleForTool: (ctx, tool) =>
        (ctx as TestPermissionContext).denied?.has(tool.name)
          ? { type: 'deny' }
          : null,
      getModeAwareTools: ({ baseTools, permissionContext, filterToolsByDenyRules }) => {
        const filtered = filterToolsByDenyRules(
          baseTools,
          permissionContext as TestPermissionContext,
        )
        return filtered.filter(tool => tool.isEnabled())
      },
    })
  })

  test('built-in discovery is owned by package runtime', () => {
    const names = getAllBaseTools().map(tool => tool.name).sort()
    expect(names).toEqual(['Alpha', 'Bravo', 'Disabled'])
  })

  test('deny-rule filtering removes denied tools', () => {
    const context: TestPermissionContext = { denied: new Set(['Bravo']) }
    const names = getTools(context as any).map(tool => tool.name).sort()
    expect(names).toEqual(['Alpha'])

    const filtered = filterToolsByDenyRules(
      [makeTool('Alpha'), makeTool('Bravo')],
      context as any,
    ).map(tool => tool.name)
    expect(filtered).toEqual(['Alpha'])
  })

  test('pool assembly merges built-in and MCP tools with stable sort', () => {
    const context: TestPermissionContext = {}
    const pool = assembleToolPool(context as any, [
      makeTool('mcp__zeta'),
      makeTool('mcp__beta'),
      makeTool('Alpha'),
    ] as any).map(tool => tool.name)

    expect(pool).toEqual(['Alpha', 'Bravo', 'mcp__beta', 'mcp__zeta'])
  })
})
