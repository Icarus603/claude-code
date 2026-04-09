export type PermissionHostBindings = {
  logDebug?: (message: string, metadata?: unknown) => void
  now?: () => number
}

