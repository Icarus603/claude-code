import type { ToolRegistryHostBindings } from './contracts.js'

let toolRegistryHostBindings: ToolRegistryHostBindings | null = null

export function installToolRegistryHostBindings(
  bindings: ToolRegistryHostBindings,
): void {
  toolRegistryHostBindings = bindings
}

export function hasToolRegistryHostBindings(): boolean {
  return toolRegistryHostBindings !== null
}

export function getToolRegistryHostBindings(): ToolRegistryHostBindings {
  if (!toolRegistryHostBindings) {
    throw new Error(
      'Tool registry host bindings have not been installed. Install host bindings before using @claude-code/tool-registry runtime APIs.',
    )
  }
  return toolRegistryHostBindings
}
