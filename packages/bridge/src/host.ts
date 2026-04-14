import type { BridgeHostBindings } from './contracts.js'
import { HostBindingsError } from './errors.js'

let bridgeHostBindings: BridgeHostBindings | null = null

export function installBridgeHostBindings(bindings: BridgeHostBindings): void {
  bridgeHostBindings = bindings
}

export function getBridgeHostBindings(): BridgeHostBindings {
  if (!bridgeHostBindings) {
    throw new HostBindingsError(
      'Bridge host bindings have not been installed.',
    )
  }
  return bridgeHostBindings
}
