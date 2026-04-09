import type { NetworkLayer } from './types.js'
import { getProviderHostBindings } from './host.js'

export function getProviderNetworkLayer(): NetworkLayer {
  return getProviderHostBindings().networkLayer
}
