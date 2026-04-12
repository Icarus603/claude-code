export type ConfigHostBindings = {
  getConfigHomeDir?: () => string
  getProjectRoot?: () => string | undefined
  logDebug?: (message: string, metadata?: unknown) => void
  // V7 §8.6 — config cannot import from mcp-runtime (integration layer).
  // The host wires this binding to mcp-runtime's getMcpConfigsByScope at
  // composition time so allErrors.ts can aggregate MCP validation errors
  // without a direct cross-layer dependency.
  // Returns ValidationError-shaped objects; the host adapter maps from
  // mcp-runtime's error type to this shape.
  getMcpErrorsByScope?: (scope: string) => Array<{
    file?: string
    path: string
    message: string
    source?: string
  }>
}

