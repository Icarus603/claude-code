import {
  endSpan as endObsSpan,
  startSpan as startObsSpan,
  type Span as ObsSpan,
} from './index.js'

export type Span = {
  spanContext?: () => { spanId?: string }
  _obsSpan?: ObsSpan
}

export type LLMRequestNewContext = {
  totalInputTokens?: number
  totalOutputTokens?: number
  totalCacheCreationInputTokens?: number
  totalCacheReadInputTokens?: number
}

export function isBetaTracingEnabled(): boolean {
  return false
}

export function isEnhancedTelemetryEnabled(): boolean {
  return false
}

export function startInteractionSpan(_userPrompt: string): Span {
  const span = startObsSpan('interaction')
  return { _obsSpan: span }
}

export function endInteractionSpan(): void {}

export function startLLMRequestSpan(
  _model: string,
  _messages: unknown[],
  _systemPrompt: string,
  _toolNames?: string[],
): Span {
  const span = startObsSpan('llm_request')
  return { _obsSpan: span }
}

export function endLLMRequestSpan(
  span: Span | undefined,
  _response?: unknown,
): void {
  endObsSpan(span?._obsSpan)
}

export function startToolSpan(
  _toolName: string,
  _input?: unknown,
): Span {
  const span = startObsSpan('tool')
  return { _obsSpan: span }
}

export function endToolSpan(
  span: Span | undefined,
  _output?: unknown,
): void {
  endObsSpan(span?._obsSpan)
}

export function startToolExecutionSpan(
  _toolName: string,
  _input?: unknown,
): Span {
  const span = startObsSpan('tool_execution')
  return { _obsSpan: span }
}

export function startToolBlockedOnUserSpan(_toolName: string): Span {
  const span = startObsSpan('tool_blocked_on_user')
  return { _obsSpan: span }
}

export function endToolExecutionSpan(
  span: Span | undefined,
  _output?: unknown,
): void {
  endObsSpan(span?._obsSpan)
}

export function endToolBlockedOnUserSpan(span: Span | undefined): void {
  endObsSpan(span?._obsSpan)
}

export function startHookSpan(_hookName: string, _eventName: string): Span {
  const span = startObsSpan('hook')
  return { _obsSpan: span }
}

export function endHookSpan(span: Span | undefined): void {
  endObsSpan(span?._obsSpan)
}

export function addToolContentEvent(
  _span: Span | undefined,
  _content: unknown,
): void {}
