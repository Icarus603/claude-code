export type ToolPermissionContextLike = {
  mode?: string
  [key: string]: unknown
}

export type ToolLike = {
  name: string
  aliases?: string[]
  isEnabled: () => boolean
  mcpInfo?: { serverName: string; toolName: string }
  [key: string]: unknown
}

export type ToolCategory = 'builtin' | 'mcp' | 'plugin' | 'user'

export type ToolRegistration<TTool extends ToolLike = ToolLike> = {
  tool: TTool
  category: ToolCategory
  providerName: string
}

export type ToolProvider<TTool extends ToolLike = ToolLike> = {
  name: string
  discover(): readonly TTool[] | Promise<readonly TTool[]>
}

export type ToolRegistryEvents<TTool extends ToolLike = ToolLike> = {
  onRegister?: (registration: ToolRegistration<TTool>) => void
  onUnregister?: (name: string) => void
}

export type ToolRegistryHostBindings<
  TTool extends ToolLike = ToolLike,
  TPermissionContext extends ToolPermissionContextLike = ToolPermissionContextLike,
> = {
  discoverBuiltInTools: () => readonly TTool[]
  getDenyRuleForTool: (
    permissionContext: TPermissionContext,
    tool: Pick<TTool, 'name' | 'mcpInfo'>,
  ) => unknown
  getModeAwareTools?: (args: {
    permissionContext: TPermissionContext
    baseTools: readonly TTool[]
    filterToolsByDenyRules: (
      tools: readonly TTool[],
      permissionContext: TPermissionContext,
    ) => TTool[]
  }) => TTool[]
  replOnlyToolNames: () => ReadonlySet<string>
}
