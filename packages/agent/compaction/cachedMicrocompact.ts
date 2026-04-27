/**
 *
 */

import type { CachedMCConfig } from '../types/compaction.js'


export type CachedMCState = {
  registeredTools: Set<string>
  toolOrder: string[]
  deletedRefs: Set<string>
  pinnedEdits: PinnedCacheEdits[]
  toolsSentToAPI: boolean
}

export type CacheEditsBlock = {
  type: 'cache_edits'
  edits: Array<{ type: string; tool_use_id: string }>
}

export type PinnedCacheEdits = {
  userMessageIndex: number
  block: CacheEditsBlock
}


/**
 */
export function createCachedMCState(): CachedMCState {
  return {
    registeredTools: new Set(),
    toolOrder: [],
    deletedRefs: new Set(),
    pinnedEdits: [],
    toolsSentToAPI: false,
  }
}

/**
 */
export function resetCachedMCState(state: CachedMCState): void {
  state.registeredTools.clear()
  state.toolOrder = []
  state.deletedRefs.clear()
  state.toolsSentToAPI = false
}

/**
 */
export function markToolsSentToAPI(state: CachedMCState): void {
  state.toolsSentToAPI = true
}


/**
 */
export function registerToolResult(
  state: CachedMCState,
  toolId: string,
): void {
  if (state.deletedRefs.has(toolId)) return
  if (state.registeredTools.has(toolId)) return
  state.registeredTools.add(toolId)
  state.toolOrder.push(toolId)
}

/**
 */
export function registerToolMessage(
  state: CachedMCState,
  groupIds: string[],
): void {
  for (const id of groupIds) {
    registerToolResult(state, id)
  }
}


/**
 *
 */
export function getToolResultsToDelete(
  state: CachedMCState,
  config: CachedMCConfig,
): string[] {
  if (!config.enabled) return []

  const activeTools = state.toolOrder.filter(id => !state.deletedRefs.has(id))

  if (activeTools.length < config.triggerThreshold) return []

  const keepRecent = Math.max(1, config.keepRecent)
  if (activeTools.length <= keepRecent) return []

  const toDelete = activeTools.slice(0, activeTools.length - keepRecent)

  for (const id of toDelete) {
    state.deletedRefs.add(id)
  }

  return toDelete
}


/**
 */
export function createCacheEditsBlock(
  state: CachedMCState,
  toolIds: string[],
): CacheEditsBlock | null {
  if (toolIds.length === 0) return null

  for (const id of toolIds) {
    state.deletedRefs.add(id)
  }

  return {
    type: 'cache_edits',
    edits: toolIds.map(id => ({
      type: 'delete_tool_result',
      tool_use_id: id,
    })),
  }
}


/**
 */
export function isCachedMicrocompactEnabled(config: CachedMCConfig): boolean {
  return config.enabled
}

/**
 */
export function isModelSupportedForCacheEditing(
  model: string,
  config: CachedMCConfig,
): boolean {
  if (config.supportedModels.length === 0) return true
  return config.supportedModels.some(
    prefix => model === prefix || model.startsWith(prefix),
  )
}

/**
 */
export function getCachedMCSimpleConfig(config: CachedMCConfig): {
  triggerThreshold: number
  keepRecent: number
} {
  return {
    triggerThreshold: config.triggerThreshold,
    keepRecent: config.keepRecent,
  }
}
