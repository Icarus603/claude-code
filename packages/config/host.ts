import type { ConfigHostBindings } from './contracts.js'

let configHostBindings: ConfigHostBindings | null = null

export function installConfigHostBindings(bindings: ConfigHostBindings): void {
  configHostBindings = bindings
}

export function getConfigHostBindings(): ConfigHostBindings {
  if (!configHostBindings) {
    throw new Error(
      'Config host bindings have not been installed. Install host bindings before using @claude-code/config runtime APIs.',
    )
  }
  return configHostBindings
}

