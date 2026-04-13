import { getAgentHostBindings } from '../host.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../internalTypes.js'

type AgentAnalyticsMetadata = Record<
  string,
  | string
  | number
  | boolean
  | AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
>

export { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS }

export function logEvent(
  event: string,
  metadata: AgentAnalyticsMetadata,
): void {
  getAgentHostBindings().logEvent?.(
    event,
    metadata as Record<string, string | number | boolean>,
  )
}

export function logError(error: unknown): void {
  const logger = getAgentHostBindings().logError
  if (logger) {
    logger(error)
    return
  }
  console.error(error)
}

export function logAntError(message: string, error: unknown): void {
  const logger = getAgentHostBindings().logAntError
  if (logger) {
    logger(message, error)
    return
  }
  console.error(message, error)
}

export function logForDebugging(
  message: string,
  metadata?: unknown,
): void {
  getAgentHostBindings().logDebug?.(message, metadata)
}
