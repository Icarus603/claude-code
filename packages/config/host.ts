import type { ConfigHostBindings } from './contracts.js'
import { HostBindingsError } from './errors.js'

let configHostBindings: ConfigHostBindings | null = null

export function installConfigHostBindings(bindings: ConfigHostBindings): void {
  configHostBindings = bindings
}

export function getConfigHostBindings(): ConfigHostBindings {
  if (!configHostBindings) {
    throw new HostBindingsError(
      'Config host bindings have not been installed. Install host bindings before using @claude-code/config runtime APIs.',
    )
  }
  return configHostBindings
}

/**
 * Safe accessor that returns empty bindings if not yet installed.
 * Use this for module-level side effects and code paths that may run
 * before host bootstrap completes. All binding calls must use `?.` optional
 * chaining — missing bindings are silently no-op'd.
 */
export function tryGetConfigHostBindings(): ConfigHostBindings {
  return configHostBindings ?? {}
}
