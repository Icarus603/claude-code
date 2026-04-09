import type { RuntimeGraph } from './contracts.js'

export function createRuntimeGraph(
  handles: Record<string, unknown> = {},
): RuntimeGraph {
  return {
    createdAt: Date.now(),
    handles,
  }
}
