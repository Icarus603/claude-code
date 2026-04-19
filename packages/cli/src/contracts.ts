export type HeadlessStateStore<TState = unknown> = {
  getState: () => TState
  setState: (...args: unknown[]) => unknown
}

export type StructuredIOOptions = {
  sdkUrl: string | undefined
  replayUserMessages?: boolean
}

export type CliHostBindings = {
  logDebug?: (message: string, metadata?: unknown) => void
  createHeadlessStore?: (params: unknown) => HeadlessStateStore
  runHeadless?: (...args: unknown[]) => Promise<void>
  getStructuredIO?: (
    inputPrompt: string | AsyncIterable<string>,
    options: StructuredIOOptions,
  ) => unknown
}

/**
 * Structural stand-in for app-level AppState used by cli handlers that
 * need to type state interactions without importing src/state/AppState
 * (V7 §7.2).
 */
export type AppStateLike = {
  [key: string]: unknown
}
