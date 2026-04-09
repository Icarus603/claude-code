export type MemoryHostBindings = {
  logDebug?: (message: string, metadata?: unknown) => void
  now?: () => number
}

