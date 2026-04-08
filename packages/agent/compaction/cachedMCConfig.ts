/**
 *
 */

import type { CachedMCConfig } from '../types/compaction.js'


export interface CachedMCConfigDeps {
  getFeatureValue<T>(key: string, defaultValue: T): T
  getEnv(key: string): string | undefined
}


export const DEFAULT_CACHED_MC_CONFIG: CachedMCConfig = {
  enabled: true,
  triggerThreshold: 20,
  keepRecent: 5,
  supportedModels: [
    'claude-sonnet-4',
    'claude-opus-4',
    'claude-3-5-sonnet',
    'claude-3-7-sonnet',
  ],
  systemPromptSuggestSummaries: false,
}


/**
 *
 */
export function getCachedMCConfig(deps: CachedMCConfigDeps): CachedMCConfig {
  const envEnabled = deps.getEnv('CLAUDE_CACHED_MC_ENABLED')
  if (envEnabled !== undefined) {
    return {
      enabled: envEnabled === '1',
      triggerThreshold:
        parseInt(deps.getEnv('CLAUDE_CACHED_MC_TRIGGER') ?? '', 10) ||
        DEFAULT_CACHED_MC_CONFIG.triggerThreshold,
      keepRecent:
        parseInt(deps.getEnv('CLAUDE_CACHED_MC_KEEP_RECENT') ?? '', 10) ||
        DEFAULT_CACHED_MC_CONFIG.keepRecent,
      supportedModels: DEFAULT_CACHED_MC_CONFIG.supportedModels,
      systemPromptSuggestSummaries:
        deps.getEnv('CLAUDE_CACHED_MC_SUGGEST_SUMMARIES') === '1',
    }
  }

  const remoteConfig = deps.getFeatureValue<CachedMCConfig>(
    'tengu_cached_microcompact',
    DEFAULT_CACHED_MC_CONFIG,
  )
  return remoteConfig ?? DEFAULT_CACHED_MC_CONFIG
}
