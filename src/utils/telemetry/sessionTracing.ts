export type Span = {
  spanContext?: () => { spanId?: string }
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
  return {}
}

export function endInteractionSpan(): void {}

export function startLLMRequestSpan(
  _model: string,
  _messages: unknown[],
  _systemPrompt: string,
  _toolNames?: string[],
): Span {
  return {}
}

export function endLLMRequestSpan(
  _span: Span | undefined,
  _response?: unknown,
): void {}

export function startToolSpan(
  _toolName: string,
  _input?: unknown,
): Span {
  return {}
}

export function endToolSpan(
  _span: Span | undefined,
  _output?: unknown,
): void {}

export function startToolExecutionSpan(
  _toolName: string,
  _input?: unknown,
): Span {
  return {}
}

export function startToolBlockedOnUserSpan(_toolName: string): Span {
  return {}
}

export function endToolExecutionSpan(
  _span: Span | undefined,
  _output?: unknown,
): void {}

export function endToolBlockedOnUserSpan(_span: Span | undefined): void {}

export function startHookSpan(_hookName: string, _eventName: string): Span {
  return {}
}

export function endHookSpan(_span: Span | undefined): void {}

export function addToolContentEvent(
  _span: Span | undefined,
  _content: unknown,
): void {}
