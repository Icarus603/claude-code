import type { RuntimeGraph, RuntimeHandles } from './contracts.js'

export function createRuntimeGraph(
  handles: RuntimeHandles,
): RuntimeGraph {
  return {
    createdAt: Date.now(),
    handles,
  }
}
