export type AgentHostBindings = {
  logDebug?: (message: string, metadata?: unknown) => void
  now?: () => number
}

