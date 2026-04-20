// @aws-sdk/credential-provider-node and @smithy/node-http-handler are imported
// dynamically in getAWSClientProxyConfig() to defer ~929KB of AWS SDK.
// undici is lazy-required inside getProxyAgent/configureGlobalAgents to defer
// ~1.5MB when no HTTPS_PROXY/mTLS env vars are set (the common case).
import axios, { type AxiosInstance } from 'axios'
import type { LookupOptions } from 'dns'
import type { Agent } from 'http'
import { HttpsProxyAgent, type HttpsProxyAgentOptions } from 'https-proxy-agent'
import memoize from 'lodash-es/memoize.js'
import type * as undici from 'undici'
import { getAllEnv, isEnvTruthy, readEnv } from '@claude-code/config/env/utils'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { getCACertificates } from './caCerts.js'
import {
  getMTLSAgent,
  getMTLSConfig,
  getTLSFetchOptions,
  type TLSConfig,
} from './mtls.js'

// Disable fetch keep-alive after a stale-pool ECONNRESET so retries open a
// fresh TCP connection instead of reusing the dead pooled socket.
let keepAliveDisabled = false

export function disableKeepAlive(): void {
  keepAliveDisabled = true
}

export function _resetKeepAliveForTesting(): void {
  keepAliveDisabled = false
}

/**
 * Convert dns.LookupOptions.family to a numeric address family value
 */
export function getAddressFamily(options: LookupOptions): 0 | 4 | 6 {
  switch (options.family) {
    case 0:
    case 4:
    case 6:
      return options.family
    case 'IPv6':
      return 6
    case 'IPv4':
    case undefined:
      return 4
    default:
      throw new Error(`Unsupported address family: ${options.family}`)
  }
}

type EnvLike = Record<string, string | undefined>

/**
 * Get the active proxy URL if one is configured
 * Prefers lowercase variants over uppercase (https_proxy > HTTPS_PROXY > http_proxy > HTTP_PROXY)
 */
export function getProxyUrl(env: EnvLike = getAllEnv()): string | undefined {
  return env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY
}

/**
 * Get the NO_PROXY environment variable value
 * Prefers lowercase over uppercase (no_proxy > NO_PROXY)
 */
export function getNoProxy(env: EnvLike = getAllEnv()): string | undefined {
  return env.no_proxy || env.NO_PROXY
}

/**
 * Check if a URL should bypass the proxy based on NO_PROXY environment variable
 */
export function shouldBypassProxy(
  urlString: string,
  noProxy: string | undefined = getNoProxy(),
): boolean {
  if (!noProxy) return false

  // Handle wildcard
  if (noProxy === '*') return true

  try {
    const url = new URL(urlString)
    const hostname = url.hostname.toLowerCase()
    const port = url.port || (url.protocol === 'https:' ? '443' : '80')
    const hostWithPort = `${hostname}:${port}`

    const noProxyList = noProxy.split(/[,\s]+/).filter(Boolean)

    return noProxyList.some(pattern => {
      pattern = pattern.toLowerCase().trim()

      if (pattern.includes(':')) {
        return hostWithPort === pattern
      }

      if (pattern.startsWith('.')) {
        const suffix = pattern
        return hostname === pattern.substring(1) || hostname.endsWith(suffix)
      }

      return hostname === pattern
    })
  } catch {
    return false
  }
}

/**
 * Create an HttpsProxyAgent with optional mTLS configuration
 */
function createHttpsProxyAgent(
  proxyUrl: string,
  extra: HttpsProxyAgentOptions<string> = {},
): HttpsProxyAgent<string> {
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  const agentOptions: HttpsProxyAgentOptions<string> = {
    ...(mtlsConfig && {
      cert: mtlsConfig.cert,
      key: mtlsConfig.key,
      passphrase: mtlsConfig.passphrase,
    }),
    ...(caCerts && { ca: caCerts }),
  }

  if (isEnvTruthy(readEnv('CLAUDE_CODE_PROXY_RESOLVES_HOSTS'))) {
    // Skip local DNS resolution - let the proxy resolve hostnames
    agentOptions.lookup = (hostname, options, callback) => {
      callback(null, hostname, getAddressFamily(options))
    }
  }

  return new HttpsProxyAgent(proxyUrl, { ...agentOptions, ...extra })
}

/**
 * Axios instance with its own proxy agent.
 */
export function createAxiosInstance(
  extra: HttpsProxyAgentOptions<string> = {},
): AxiosInstance {
  const proxyUrl = getProxyUrl()
  const mtlsAgent = getMTLSAgent()
  const instance = axios.create({ proxy: false })

  if (!proxyUrl) {
    if (mtlsAgent) instance.defaults.httpsAgent = mtlsAgent
    return instance
  }

  const proxyAgent = createHttpsProxyAgent(proxyUrl, extra)
  instance.interceptors.request.use(config => {
    if (config.url && shouldBypassProxy(config.url)) {
      config.httpsAgent = mtlsAgent
      config.httpAgent = mtlsAgent
    } else {
      config.httpsAgent = proxyAgent
      config.httpAgent = proxyAgent
    }
    return config
  })
  return instance
}

/**
 * Get or create a memoized proxy agent for the given URI
 */
export const getProxyAgent = memoize((uri: string): undici.Dispatcher => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const undiciMod = require('undici') as typeof undici
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  const proxyOptions: undici.EnvHttpProxyAgent.Options & {
    requestTls?: {
      cert?: string | Buffer
      key?: string | Buffer
      passphrase?: string
      ca?: string | string[] | Buffer
    }
  } = {
    httpProxy: uri,
    httpsProxy: uri,
    noProxy: readEnv('NO_PROXY') || readEnv('no_proxy'),
  }

  if (mtlsConfig || caCerts) {
    const tlsOpts = {
      ...(mtlsConfig && {
        cert: mtlsConfig.cert,
        key: mtlsConfig.key,
        passphrase: mtlsConfig.passphrase,
      }),
      ...(caCerts && { ca: caCerts }),
    }
    proxyOptions.connect = tlsOpts
    proxyOptions.requestTls = tlsOpts
  }

  return new undiciMod.EnvHttpProxyAgent(proxyOptions)
})

/**
 * Get an HTTP agent configured for WebSocket proxy support
 */
export function getWebSocketProxyAgent(url: string): Agent | undefined {
  const proxyUrl = getProxyUrl()

  if (!proxyUrl) {
    return undefined
  }

  if (shouldBypassProxy(url)) {
    return undefined
  }

  return createHttpsProxyAgent(proxyUrl)
}

/**
 * Get the proxy URL for WebSocket connections under Bun.
 */
export function getWebSocketProxyUrl(url: string): string | undefined {
  const proxyUrl = getProxyUrl()

  if (!proxyUrl) {
    return undefined
  }

  if (shouldBypassProxy(url)) {
    return undefined
  }

  return proxyUrl
}

/**
 * Get fetch options for the Anthropic SDK with proxy and mTLS configuration
 */
export function getProxyFetchOptions(opts?: { forAnthropicAPI?: boolean }): {
  tls?: TLSConfig
  dispatcher?: undici.Dispatcher
  proxy?: string
  unix?: string
  keepalive?: false
} {
  const base = keepAliveDisabled ? ({ keepalive: false } as const) : {}

  if (opts?.forAnthropicAPI) {
    const unixSocket = readEnv('ANTHROPIC_UNIX_SOCKET')
    if (unixSocket && typeof Bun !== 'undefined') {
      return { ...base, unix: unixSocket }
    }
  }

  const proxyUrl = getProxyUrl()

  if (proxyUrl) {
    if (typeof Bun !== 'undefined') {
      return { ...base, proxy: proxyUrl, ...getTLSFetchOptions() }
    }
    return { ...base, dispatcher: getProxyAgent(proxyUrl) }
  }

  return { ...base, ...getTLSFetchOptions() }
}

/**
 * Configure global HTTP agents for both axios and undici
 */
let proxyInterceptorId: number | undefined

export function configureGlobalAgents(): void {
  const proxyUrl = getProxyUrl()
  const mtlsAgent = getMTLSAgent()

  if (proxyInterceptorId !== undefined) {
    axios.interceptors.request.eject(proxyInterceptorId)
    proxyInterceptorId = undefined
  }

  axios.defaults.proxy = undefined
  axios.defaults.httpAgent = undefined
  axios.defaults.httpsAgent = undefined

  if (proxyUrl) {
    axios.defaults.proxy = false

    const proxyAgent = createHttpsProxyAgent(proxyUrl)

    proxyInterceptorId = axios.interceptors.request.use(config => {
      if (config.url && shouldBypassProxy(config.url)) {
        if (mtlsAgent) {
          config.httpsAgent = mtlsAgent
          config.httpAgent = mtlsAgent
        } else {
          delete config.httpsAgent
          delete config.httpAgent
        }
      } else {
        config.httpsAgent = proxyAgent
        config.httpAgent = proxyAgent
      }
      return config
    })

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ;(require('undici') as typeof undici).setGlobalDispatcher(
      getProxyAgent(proxyUrl),
    )
  } else if (mtlsAgent) {
    axios.defaults.httpsAgent = mtlsAgent

    const mtlsOptions = getTLSFetchOptions()
    if (mtlsOptions.dispatcher) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ;(require('undici') as typeof undici).setGlobalDispatcher(
        mtlsOptions.dispatcher,
      )
    }
  }
}

/**
 * Get AWS SDK client configuration with proxy support
 */
export async function getAWSClientProxyConfig(): Promise<object> {
  const proxyUrl = getProxyUrl()

  if (!proxyUrl) {
    return {}
  }

  const [{ NodeHttpHandler }, { defaultProvider }] = await Promise.all([
    import('@smithy/node-http-handler'),
    import('@aws-sdk/credential-provider-node'),
  ])

  const agent = createHttpsProxyAgent(proxyUrl)
  const requestHandler = new NodeHttpHandler({
    httpAgent: agent,
    httpsAgent: agent,
  })

  return {
    requestHandler,
    credentials: defaultProvider({
      clientConfig: { requestHandler },
    }),
  }
}

/**
 * Clear proxy agent cache.
 */
export function clearProxyCache(): void {
  getProxyAgent.cache.clear?.()
  logForDebugging('Cleared proxy agent cache')
}
