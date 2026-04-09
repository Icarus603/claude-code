import type { ToolLike, ToolProvider } from '../contracts.js'
import { getToolRegistryHostBindings } from '../host.js'

export const BuiltInToolsProvider: ToolProvider<ToolLike> = {
  name: 'builtin',
  discover(): readonly ToolLike[] {
    return getToolRegistryHostBindings().discoverBuiltInTools()
  },
}
