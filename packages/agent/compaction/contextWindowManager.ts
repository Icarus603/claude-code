/**
 *
 */

import type { TokenWarningState } from '../types/compaction.js'


const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000

export const AUTOCOMPACT_BUFFER_TOKENS = 13_000
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
export const ERROR_THRESHOLD_BUFFER_TOKENS = 20_000
export const MANUAL_COMPACT_BUFFER_TOKENS = 3_000
export const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3


export interface ContextWindowDeps {
  getContextWindowSize(model: string, betas: string[]): number
  getMaxOutputTokensForModel(model: string): number
  getSdkBetas(): string[]
  getEnv(key: string): string | undefined
}


/**
 */
export function getEffectiveContextWindowSize(
  model: string,
  deps: ContextWindowDeps,
): number {
  const reservedTokensForSummary = Math.min(
    deps.getMaxOutputTokensForModel(model),
    MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  )
  let contextWindow = deps.getContextWindowSize(model, deps.getSdkBetas())

  const autoCompactWindow = deps.getEnv('CLAUDE_CODE_AUTO_COMPACT_WINDOW')
  if (autoCompactWindow) {
    const parsed = parseInt(autoCompactWindow, 10)
    if (!isNaN(parsed) && parsed > 0) {
      contextWindow = Math.min(contextWindow, parsed)
    }
  }

  return contextWindow - reservedTokensForSummary
}

/**
 */
export function getAutoCompactThreshold(
  model: string,
  deps: ContextWindowDeps,
): number {
  const effectiveContextWindow = getEffectiveContextWindowSize(model, deps)

  const autocompactThreshold =
    effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS

  // Override for easier testing of autocompact
  const envPercent = deps.getEnv('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE')
  if (envPercent) {
    const parsed = parseFloat(envPercent)
    if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
      const percentageThreshold = Math.floor(
        effectiveContextWindow * (parsed / 100),
      )
      return Math.min(percentageThreshold, autocompactThreshold)
    }
  }

  return autocompactThreshold
}

/**
 */
export function calculateTokenWarningState(
  tokenUsage: number,
  model: string,
  deps: ContextWindowDeps,
  autoCompactEnabled: boolean,
): TokenWarningState {
  const autoCompactThreshold = getAutoCompactThreshold(model, deps)
  const threshold = autoCompactEnabled
    ? autoCompactThreshold
    : getEffectiveContextWindowSize(model, deps)

  const percentLeft = Math.max(
    0,
    Math.round(((threshold - tokenUsage) / threshold) * 100),
  )

  const warningThreshold = threshold - WARNING_THRESHOLD_BUFFER_TOKENS
  const errorThreshold = threshold - ERROR_THRESHOLD_BUFFER_TOKENS

  const isAboveWarningThreshold = tokenUsage >= warningThreshold
  const isAboveErrorThreshold = tokenUsage >= errorThreshold

  const isAboveAutoCompactThreshold =
    autoCompactEnabled && tokenUsage >= autoCompactThreshold

  const actualContextWindow = getEffectiveContextWindowSize(model, deps)
  const defaultBlockingLimit =
    actualContextWindow - MANUAL_COMPACT_BUFFER_TOKENS

  // Allow override for testing
  const blockingLimitOverride = deps.getEnv('CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE')
  const parsedOverride = blockingLimitOverride
    ? parseInt(blockingLimitOverride, 10)
    : NaN
  const blockingLimit =
    !isNaN(parsedOverride) && parsedOverride > 0
      ? parsedOverride
      : defaultBlockingLimit

  const isAtBlockingLimit = tokenUsage >= blockingLimit

  return {
    percentLeft,
    isAboveWarningThreshold,
    isAboveErrorThreshold,
    isAboveAutoCompactThreshold,
    isAtBlockingLimit,
  }
}

/**
 */
export function isMainThreadSource(
  querySource: string | undefined,
): boolean {
  return !querySource || querySource.startsWith('repl_main_thread')
}
