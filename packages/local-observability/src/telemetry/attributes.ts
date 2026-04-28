/**
 * V7 §8.12 — telemetry/attributes: `getTelemetryAttributes()`.
 *
 * Moved from src/utils/telemetryAttributes.ts. Builds the OpenTelemetry
 * attribute bag for metrics emissions.
 *
 * Host-injected deps (via ../_deps.ts): getSessionId, getOauthAccountInfo,
 * getOrCreateUserID, getTerminalType, toTaggedId.
 */

import type { Attributes } from '@opentelemetry/api'

import { getSessionId } from '@claude-code/app-host/bootstrap/state.js'
import { getOrCreateUserID } from '@claude-code/config'
import { envDynamic } from '@claude-code/config/env/dynamic'
import { isEnvTruthy } from '@claude-code/config/env/utils'
import { toTaggedId } from '@claude-code/agent/taggedId.js'
import { getOauthAccountInfo } from '@claude-code/provider/authAlias.js'

const getTerminalType = (): string | undefined => envDynamic.terminal

const METRICS_CARDINALITY_DEFAULTS = {
  OTEL_METRICS_INCLUDE_SESSION_ID: true,
  OTEL_METRICS_INCLUDE_VERSION: false,
  OTEL_METRICS_INCLUDE_ACCOUNT_UUID: true,
}

function shouldIncludeAttribute(
  envVar: keyof typeof METRICS_CARDINALITY_DEFAULTS,
): boolean {
  const defaultValue = METRICS_CARDINALITY_DEFAULTS[envVar]
  const envValue = process.env[envVar]
  if (envValue === undefined) return defaultValue
  return isEnvTruthy(envValue)
}

export function getTelemetryAttributes(): Attributes {
  const userId = getOrCreateUserID()
  const sessionId = getSessionId()

  const attributes: Attributes = {
    'user.id': userId,
  }

  if (shouldIncludeAttribute('OTEL_METRICS_INCLUDE_SESSION_ID')) {
    attributes['session.id'] = sessionId
  }
  if (shouldIncludeAttribute('OTEL_METRICS_INCLUDE_VERSION')) {
    attributes['app.version'] = MACRO.VERSION
  }

  const oauthAccount = getOauthAccountInfo()
  if (oauthAccount) {
    const orgId = oauthAccount.organizationUuid
    const email = oauthAccount.emailAddress
    const accountUuid = oauthAccount.accountUuid

    if (orgId) attributes['organization.id'] = orgId
    if (email) attributes['user.email'] = email

    if (
      accountUuid &&
      shouldIncludeAttribute('OTEL_METRICS_INCLUDE_ACCOUNT_UUID')
    ) {
      attributes['user.account_uuid'] = accountUuid
      attributes['user.account_id'] =
        process.env.CLAUDE_CODE_ACCOUNT_TAGGED_ID ||
        toTaggedId('user', accountUuid)
    }
  }

  const terminal = getTerminalType()
  if (terminal) attributes['terminal.type'] = terminal

  return attributes
}
