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
}

