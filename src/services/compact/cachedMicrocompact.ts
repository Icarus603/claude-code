import type { CachedMCConfig } from '../../../packages/agent/types/compaction.js'

export type {
  CachedMCState,
  CacheEditsBlock,
  PinnedCacheEdits,
} from '../../../packages/agent/compaction/cachedMicrocompact.js'

export {
  createCachedMCState,
  resetCachedMCState,
  markToolsSentToAPI,
  registerToolResult,
  registerToolMessage,
  createCacheEditsBlock,
} from '../../../packages/agent/compaction/cachedMicrocompact.js'

import {
  getToolResultsToDelete as getToolResultsToDeleteImpl,
  isCachedMicrocompactEnabled as isCachedMicrocompactEnabledImpl,
  isModelSupportedForCacheEditing as isModelSupportedForCacheEditingImpl,
  getCachedMCSimpleConfig as getCachedMCSimpleConfigImpl,
} from '../../../packages/agent/compaction/cachedMicrocompact.js'
import {
  getCachedMCConfig as getFullCachedMCConfig,
} from './cachedMCConfig.js'

export function getToolResultsToDelete(
  state: import('../../../packages/agent/compaction/cachedMicrocompact.js').CachedMCState,
): string[] {
  return getToolResultsToDeleteImpl(state, getFullCachedMCConfig())
}

export function isCachedMicrocompactEnabled(): boolean {
  return isCachedMicrocompactEnabledImpl(getFullCachedMCConfig())
}

export function isModelSupportedForCacheEditing(model: string): boolean {
  return isModelSupportedForCacheEditingImpl(model, getFullCachedMCConfig())
}

export function getCachedMCConfig(): Pick<
  CachedMCConfig,
  'triggerThreshold' | 'keepRecent'
> {
  return getCachedMCSimpleConfigImpl(getFullCachedMCConfig())
}
