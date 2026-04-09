import {
  createAxiosInstance,
  getProxyFetchOptions,
  getProxyUrl,
  shouldBypassProxy,
} from '../../../src/utils/proxy.js'
import type { NetworkLayer } from './types.js'

const networkLayer: NetworkLayer = {
  getProxyFetchOptions,
  createAxiosInstance,
  getProxyUrl,
  shouldBypassProxy,
}

export function getProviderNetworkLayer(): NetworkLayer {
  return networkLayer
}
