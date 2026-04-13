import { getAgentHostBindings } from '../host.js'

export function getInMemoryErrors(): unknown[] {
  return getAgentHostBindings().getInMemoryErrors?.() ?? []
}

export function categorizeRetryableAPIError(error: unknown): unknown {
  return getAgentHostBindings().categorizeRetryableAPIError?.(error) ?? error
}

export function getTotalAPIDuration(): number {
  return getAgentHostBindings().getTotalAPIDuration?.() ?? 0
}

export function getTotalCost(): number {
  return getAgentHostBindings().getTotalCost?.() ?? 0
}

export function getModelUsage(): Record<string, unknown> {
  return getAgentHostBindings().getModelUsage?.() ?? {}
}

export function getFastModeState(
  model: string,
  fastMode?: boolean,
): unknown {
  return getAgentHostBindings().getFastModeState?.(model, fastMode) ?? null
}
