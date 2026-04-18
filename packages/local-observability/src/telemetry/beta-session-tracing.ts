/**
 * V7 §8.12 — beta-session-tracing: stub implementations used by other
 * telemetry code.
 *
 * Moved from src/utils/telemetry/betaSessionTracing.ts. In the external
 * build this feature is eliminated; the stubs keep call sites honest
 * without runtime cost.
 */

export type LLMRequestNewContext = {
  totalInputTokens?: number
  totalOutputTokens?: number
  totalCacheCreationInputTokens?: number
  totalCacheReadInputTokens?: number
}

export function isBetaTracingEnabled(): boolean {
  return false
}

export function clearBetaTracingState(): void {}

export function addBetaInteractionAttributes(
  _span: unknown,
  _userPrompt: string,
): void {}

export function addBetaLLMRequestAttributes(
  _span: unknown,
  _messages: unknown[],
  _systemPrompt: string,
  _toolNames?: string[],
): void {}

export function addBetaLLMResponseAttributes(
  _span: unknown,
  _response?: unknown,
): void {}

export function addBetaToolInputAttributes(
  _span: unknown,
  _toolName: string,
  _input?: unknown,
): void {}

export function addBetaToolResultAttributes(
  _span: unknown,
  _output?: unknown,
): void {}

export function truncateContent(content: string, limit = 200): string {
  return content.length > limit ? `${content.slice(0, limit)}...` : content
}
