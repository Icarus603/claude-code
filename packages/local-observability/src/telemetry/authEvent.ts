/**
 * Port of ant v2.1.136 vBH (2642.js) — typed helper for the OTel
 * `claude_code.auth` structured event.
 *
 * ant shape:
 *   k5("auth", {
 *     action: H.action,
 *     success: String(H.success),
 *     auth_method: H.authMethod,
 *     ...(error && {
 *       error_category: errClass.kind,
 *       ...(status !== undefined && { status_code: String(status) }),
 *     }),
 *   })
 *
 * Caller passes a JS error; we duck-type-detect axios responses and emit
 * `error_category` of "auth"|"timeout"|"network"|"http"|"other" matching
 * ant VV(H) in 0191.js.
 */

import { logOTelEvent } from './events.js'

export type AuthAction =
  | 'login'
  | 'logout'
  | 'refresh'
  | 'token_exchange'
  | 'api_key_create'

export type AuthMethod = 'oauth' | 'api_key' | 'env_var'

export type AuthEvent = {
  action: AuthAction
  success: boolean
  authMethod: AuthMethod
  error?: unknown
}

function classifyError(error: unknown): {
  kind: 'auth' | 'timeout' | 'network' | 'http' | 'other'
  status?: number
} {
  if (
    !error ||
    typeof error !== 'object' ||
    !('isAxiosError' in error) ||
    !(error as { isAxiosError?: boolean }).isAxiosError
  ) {
    return { kind: 'other' }
  }
  const e = error as {
    response?: { status?: number }
    code?: string
  }
  const status = e.response?.status
  if (status === 401 || status === 403) return { kind: 'auth', status }
  if (e.code === 'ECONNABORTED') return { kind: 'timeout', status }
  if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND')
    return { kind: 'network', status }
  return { kind: 'http', status }
}

export async function logAuthEvent(event: AuthEvent): Promise<void> {
  const metadata: { [key: string]: string | undefined } = {
    action: event.action,
    success: String(event.success),
    auth_method: event.authMethod,
  }
  if (event.error !== undefined) {
    const cls = classifyError(event.error)
    metadata.error_category = cls.kind
    if (cls.status !== undefined) {
      metadata.status_code = String(cls.status)
    }
  }
  await logOTelEvent('auth', metadata)
}
