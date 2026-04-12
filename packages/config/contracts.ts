export type ConfigHostBindings = {
  getConfigHomeDir?: () => string
  getProjectRoot?: () => string | undefined
  logDebug?: (message: string, metadata?: unknown) => void
  // V7 §8.6 — config cannot import from mcp-runtime (integration layer).
  // The host wires this binding to mcp-runtime's getMcpConfigsByScope at
  // composition time so allErrors.ts can aggregate MCP validation errors
  // without a direct cross-layer dependency.
  getMcpErrorsByScope?: (scope: string) => Array<{
    file?: string
    path: string
    message: string
    source?: string
  }>
  // V7 §8.6 — config cannot import from provider/auth (Wave 3). The host
  // wires this to the full isRemoteManagedSettingsEligible() logic at
  // composition time. Config calls it and caches the boolean.
  checkRemoteSettingsEligibility?: () => boolean
  // V7 §7 — bootstrap state bindings. Config reads these but does not own
  // session-level bootstrap state (that's app-host).
  getIsRemoteMode?: () => boolean
  // V7 §8.6 — lifecycle hook for cleanup on process exit.
  registerCleanup?: (fn: () => Promise<void>) => () => void
  // V7 §8.6 — hook execution bridge. Config cannot import the hooks runtime.
  // Returns true if any hook blocked the change.
  executeConfigChangeHooks?: (source: string) => Promise<{ blocked: boolean }>
  // V7 §8.6 — local-observability bridge for diagnostic logging (MDM telemetry).
  logDiagnostics?: (level: string, event: string, data?: Record<string, unknown>) => void
  // V7 §8.6 — startup profiler bridge (optional, no-op if not installed).
  profileCheckpoint?: (name: string) => void
}

