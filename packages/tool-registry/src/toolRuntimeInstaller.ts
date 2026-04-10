import {
  hasToolRegistryHostBindings,
  installToolRegistryHostBindings,
} from './host.js'

let toolRegistryRuntimeInstalled = false

const FALLBACK_BUILT_IN_TOOLS = [
  {
    name: 'Agent',
    description: 'Fallback Agent tool',
  },
  {
    name: 'Bash',
    description: 'Fallback Bash tool',
  },
  {
    name: 'Read',
    description: 'Fallback Read tool',
  },
  {
    name: 'Edit',
    description: 'Fallback Edit tool',
  },
].map(tool => ({
  ...tool,
  inputSchema: {
    type: 'object',
    properties: {},
  },
  call: async () => ({}),
  isEnabled: () => true,
}))

export function ensureToolRegistryRuntimeInstalled(): void {
  if (toolRegistryRuntimeInstalled || hasToolRegistryHostBindings()) {
    toolRegistryRuntimeInstalled = true
    return
  }

  installToolRegistryHostBindings({
    discoverBuiltInTools: () => FALLBACK_BUILT_IN_TOOLS,
    getDenyRuleForTool: (permissionContext, tool) => {
      const denyRules = [
        ...(Array.isArray((permissionContext as any)?.alwaysDenyRules?.localSettings)
          ? (permissionContext as any).alwaysDenyRules.localSettings
          : []),
        ...(Array.isArray((permissionContext as any)?.alwaysDenyRules?.projectSettings)
          ? (permissionContext as any).alwaysDenyRules.projectSettings
          : []),
        ...(Array.isArray((permissionContext as any)?.alwaysDenyRules?.userSettings)
          ? (permissionContext as any).alwaysDenyRules.userSettings
          : []),
      ]
      if (denyRules.includes(tool.name)) {
        return tool.name
      }
      if (tool.mcpInfo) {
        const qualified = `mcp__${tool.mcpInfo.serverName}__${tool.mcpInfo.toolName}`
        if (denyRules.includes(qualified)) {
          return qualified
        }
      }
      return null
    },
    getModeAwareTools: ({
      permissionContext,
      baseTools,
      filterToolsByDenyRules,
    }) => filterToolsByDenyRules(baseTools, permissionContext),
    replOnlyToolNames: () => new Set(),
  })
  toolRegistryRuntimeInstalled = true
}
