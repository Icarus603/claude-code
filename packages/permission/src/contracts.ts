export type PermissionHostBindings = {
  logDebug?: (message: string, metadata?: unknown) => void
  now?: () => number
  addPermissionRulesToSettings?: (...args: unknown[]) => boolean
  // V7 §11.4 — memory path check bridges (permission cannot import memory in Wave 2).
  hasAutoMemPathOverride?: () => boolean
  isAutoMemPath?: (absolutePath: string) => boolean
  isAgentMemoryPath?: (absolutePath: string) => boolean
}

