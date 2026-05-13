/**
 * Trusted device token source — byte-for-byte port of ant v2.1.136 3157.js
 * (`tN` module): `wgH` / `PRH` / `t66` / `U$5` / `U$H` / `G$_` / `kJ8` /
 * `VJ8` / `JgH` / `ZJ8` / `LJ8` / `wO7` / `YgH`.
 *
 * Bridge sessions have SecurityTier=ELEVATED on the server (CCR v2). The
 * server gates ConnectBridgeWorker on its own flag; this CLI-side gating
 * controls whether the CLI sends X-Trusted-Device-Token at all.
 *
 * Two flags + one org policy:
 *   - `tengu_sessions_elevated_auth_enforcement` (`ZJ8`) — GrowthBook gate.
 *     When OFF, the CLI never reads / sends / clears the token.
 *   - `require_trusted_devices` (`LJ8`) — managed-policy entry the org admin
 *     can flip to enforce trusted devices for their members.
 *   - `tengu_sessions_elevated_auth_disable_proactive_enrollment` (`wO7`)
 *     — kill-switch (server-side override) that disables ENROLLMENT.
 *     Token-send and gate-enforcement paths are unaffected. Used during
 *     enrollment-endpoint outages so users don't see spurious 5xx during
 *     /login.
 *
 * Combined gate (`wgH`):
 *     gate=on  AND  isPolicyAllowed(require_trusted_devices)
 *
 * Enrollment (POST /auth/trusted_devices) is gated server-side by
 * account_session.created_at < 10min, so it must happen during /login.
 * Token is persistent (90d rolling expiry) and stored in keychain.
 *
 * See anthropics/anthropic#274559 (spec), #310375 (B1b tenant RPCs),
 * #295987 (B2 Python routes), #307150 (C1' CCR v2 gate).
 */
import axios from 'axios'
import memoize from 'lodash-es/memoize.js'
import { hostname } from 'os'
import { getOauthConfig } from '@claude-code/provider/oauthConstants'
import {
  checkGate_CACHED_OR_BLOCKING,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from '@claude-code/config/feature-flags'
import {
  isPolicyAllowed,
  waitForPolicyLimitsToLoad,
} from '@claude-code/provider/policyLimits/index.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { errorMessage } from '@claude-code/local-observability/errorHelpers.js'
import { logForDiagnosticsNoPII } from '@claude-code/local-observability/logging'
import { isEssentialTrafficOnly } from '@claude-code/config/env/privacy-level'
import { getSecureStorage } from '@claude-code/storage/secureStorage.js'
import { jsonStringify } from '@claude-code/local-observability/slowOperations.js'

// Ant `ZJ8`
const TRUSTED_DEVICE_GATE = 'tengu_sessions_elevated_auth_enforcement'
// Ant `LJ8`
const TRUSTED_DEVICE_POLICY = 'require_trusted_devices'
// Ant `wO7`
const TRUSTED_DEVICE_PROACTIVE_DISABLE_GATE =
  'tengu_sessions_elevated_auth_disable_proactive_enrollment'
// Ant `bridge_trusted_device_enroll` telemetry counter name. Each call
// site below logs a `<COUNTER>_<reason>` event matching ant's
// xH(counter, reason) / yH(counter) / G6(counter, reason) pattern, so
// the funnel-drop dashboards align across ccb and ant.
const ENROLL_COUNTER = 'bridge_trusted_device_enroll'

function reportFail(reason: string): void {
  // Ant uses two distinct codes: `xH` (definitive failure) vs `G6`
  // (warn / soft-fail). The trustedDevice file only uses `xH` for the
  // enrollment counter, so a single helper here is sufficient.
  logForDiagnosticsNoPII('error', `${ENROLL_COUNTER}_${reason}`)
}

function reportSuccess(): void {
  logForDiagnosticsNoPII('info', `${ENROLL_COUNTER}_completed`)
}

// Ant `YgH` — verbatim
export const PROACTIVE_ENROLLMENT_DISABLED_MESSAGE =
  'Your organization requires Trusted Devices for Remote Control, but enrollment is temporarily disabled. Please try again later, or contact your administrator.'

// Ant `U$5` non-disabled message
export const TRUSTED_DEVICE_UNENROLLED_MESSAGE =
  'Your organization requires Trusted Devices for Remote Control, but this device is not enrolled. Please run `/login` in Claude Code to enroll this device.'

/**
 * Ant `U$H` — kill-switch reader. Used both to skip enrollment and to
 * select the proactive-disabled error message in `getTrustedDeviceUnenrolledReason`.
 */
function isProactiveEnrollmentDisabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE(
    TRUSTED_DEVICE_PROACTIVE_DISABLE_GATE,
    false,
  )
}

/**
 * Ant `wgH` — combined gate: GrowthBook flag AND org policy. This is
 * the single source-of-truth `isGateEnabled` used by all 7 trustedDevice
 * call sites. The two-axis check matters because:
 *   - GrowthBook gate gives Anthropic per-account staged rollout.
 *   - Org policy gives the customer's admin opt-out for their workspace.
 * BOTH must be on for the trusted-device path to engage.
 */
function isTrustedDeviceGateEnabled(): boolean {
  if (
    !getFeatureValue_CACHED_MAY_BE_STALE(TRUSTED_DEVICE_GATE, false)
  ) {
    return false
  }
  return isPolicyAllowed(TRUSTED_DEVICE_POLICY)
}

/**
 * Ant `JgH` — keychain-read memoization. `getSecureStorage().read()`
 * spawns a macOS `security` subprocess (~40ms) and bridgeApi.ts calls
 * this from getHeaders() on every poll/heartbeat/ack. The env-var
 * override (`CLAUDE_TRUSTED_DEVICE_TOKEN`) shadows the keychain read so
 * enterprise wrappers can inject a pre-issued token without touching
 * the user's keychain.
 *
 * Cache cleared by `clearTrustedDeviceTokenCache` (`G$_`), and by the
 * enrollment success path (`VJ8` calls cache.clear after persisting).
 */
const readStoredTrustedDeviceToken = memoize((): string | undefined => {
  const envToken = process.env.CLAUDE_TRUSTED_DEVICE_TOKEN
  if (envToken) return envToken
  return getSecureStorage().read()?.trustedDeviceToken
})

/** Public read so non-bridge callsites can introspect the cached value. */
export function readStoredTrustedDeviceTokenForTesting(): string | undefined {
  return readStoredTrustedDeviceToken()
}

/**
 * Ant `PRH` — gated token getter. Returns undefined when the combined
 * gate is off so callers never accidentally send a stale token while
 * the feature is disabled.
 */
export function getTrustedDeviceToken(): string | undefined {
  if (!isTrustedDeviceGateEnabled()) return undefined
  return readStoredTrustedDeviceToken()
}

/**
 * Ant `t66` — is this device gate-on but unenrolled? Pure predicate used
 * by `getTrustedDeviceUnenrolledReason` and any UI surface that needs to
 * show an enrollment nag.
 */
export function isTrustedDeviceUnenrolled(): boolean {
  if (!isTrustedDeviceGateEnabled()) return false
  if (readStoredTrustedDeviceToken()) return false
  return true
}

/**
 * Ant `U$5` — returns the user-visible message when the device should
 * be enrolled but isn't, or null when no issue.
 *
 * Two failure modes:
 *   - Server-disabled (proactive disable gate on) → temporary message.
 *   - Device not enrolled (no token stored) → run /login message.
 */
export function getTrustedDeviceUnenrolledReason(): string | null {
  if (!isTrustedDeviceUnenrolled()) return null
  if (isProactiveEnrollmentDisabled())
    return PROACTIVE_ENROLLMENT_DISABLED_MESSAGE
  return TRUSTED_DEVICE_UNENROLLED_MESSAGE
}

/** Ant `G$_` — keychain-read cache invalidator. */
export function clearTrustedDeviceTokenCache(): void {
  readStoredTrustedDeviceToken.cache?.clear?.()
}

/**
 * Ant `kJ8` — clear the stored trusted device token. Critical: the
 * proactive-disabled kill-switch ABORTS clearing so that during an
 * enrollment-endpoint outage we don't trash a valid existing token
 * (the outage would prevent re-enrollment, leaving the user with no
 * way to recover bridge access until the outage ends).
 *
 * Best-effort: the keychain write is wrapped in catch so a permission
 * issue can't block the login flow.
 *
 * Note: ant uses `h1().mutate(fn => ...)` for atomic read-modify-write;
 * ccb's secureStorage only exposes `read()` + `update()` so there's a
 * narrow window where a concurrent keychain write could be lost. The
 * window only opens on /login (caller already serialised) so the race
 * is theoretical in practice.
 */
export function clearTrustedDeviceToken(): void {
  if (isProactiveEnrollmentDisabled()) return
  clearTrustedDeviceTokenCache()
  const secureStorage = getSecureStorage()
  try {
    const data = secureStorage.read()
    if (data?.trustedDeviceToken) {
      delete data.trustedDeviceToken
      secureStorage.update(data)
    }
  } catch {
    // best-effort
  }
}

/**
 * Ant `VJ8` — enroll this device via POST /auth/trusted_devices and
 * persist the token to keychain. Best-effort: logs and returns on
 * failure so callers (post-login hooks) don't block the login flow.
 *
 * The server gates enrollment on account_session.created_at < 10min,
 * so this must be called immediately after a fresh /login. Calling it
 * later (e.g. lazy enrollment on /bridge 403) will fail with 403
 * stale_session.
 *
 * Ant's exact order of gate checks (replicated here for behaviour parity):
 *   1. checkGate_CACHED_OR_BLOCKING(TRUSTED_DEVICE_GATE)
 *   2. isProactiveEnrollmentDisabled()
 *   3. CLAUDE_TRUSTED_DEVICE_TOKEN env var precedence
 *   4. waitForPolicyLimitsToLoad() + isPolicyAllowed(require_trusted_devices)
 *   5. OAuth access token present
 *   6. isEssentialTrafficOnly() opt-out
 *   7. POST /api/auth/trusted_devices
 *   8. Persist token + clear cache
 *
 * Each early-exit fires the matching `bridge_trusted_device_enroll`
 * telemetry counter so dashboards can split funnel drop-off by cause.
 */
export async function enrollTrustedDevice(): Promise<void> {
  try {
    // 1. GrowthBook gate — checkGate_CACHED_OR_BLOCKING awaits any in-flight
    //    re-init triggered by refreshGrowthBookAfterAuthChange in login.tsx.
    if (!(await checkGate_CACHED_OR_BLOCKING(TRUSTED_DEVICE_GATE))) {
      logForDebugging(
        `[trusted-device] Gate ${TRUSTED_DEVICE_GATE} is off, skipping enrollment`,
      )
      return
    }
    // 2. Outage kill-switch.
    if (isProactiveEnrollmentDisabled()) {
      logForDebugging(
        `[trusted-device] Proactive enrollment disabled via ${TRUSTED_DEVICE_PROACTIVE_DISABLE_GATE}, skipping`,
      )
      return
    }
    // 3. Env-var precedence — readStoredTrustedDeviceToken honours the env
    //    var so enrolling would write a token that's permanently shadowed.
    if (process.env.CLAUDE_TRUSTED_DEVICE_TOKEN) {
      logForDebugging(
        '[trusted-device] CLAUDE_TRUSTED_DEVICE_TOKEN env var is set, skipping enrollment (env var takes precedence)',
      )
      return
    }
    // 4. Org policy gate — ant explicitly awaits policy load before checking
    //    so a race between /login and the policy fetch doesn't false-fail.
    await waitForPolicyLimitsToLoad()
    if (!isPolicyAllowed(TRUSTED_DEVICE_POLICY)) {
      logForDebugging(
        `[trusted-device] Org has not enabled ${TRUSTED_DEVICE_POLICY}, skipping enrollment`,
      )
      return
    }
    // 5. OAuth access token — lazy require to avoid pulling the auth graph
    //    into daemon callers that just want to READ the cached token.
    const { getClaudeAIOAuthTokens } = await import(
      '@claude-code/provider/authAlias.js'
    )
    const accessToken = getClaudeAIOAuthTokens()?.accessToken
    if (!accessToken) {
      logForDebugging('[trusted-device] No OAuth token, skipping enrollment')
      return
    }
    // 6. Essential-traffic-only opt-out (HIPAA orgs etc).
    if (isEssentialTrafficOnly()) {
      logForDebugging(
        '[trusted-device] Essential traffic only, skipping enrollment',
      )
      return
    }

    // 7. POST /api/auth/trusted_devices.
    const baseUrl = getOauthConfig().BASE_API_URL
    let response
    try {
      response = await axios.post<{
        device_token?: string
        device_id?: string
      }>(
        `${baseUrl}/api/auth/trusted_devices`,
        { display_name: `Claude Code on ${hostname()} · ${process.platform}` },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10_000,
          validateStatus: s => s < 500,
        },
      )
    } catch (err: unknown) {
      logForDebugging(
        `[trusted-device] Enrollment request failed: ${errorMessage(err)}`,
      )
      reportFail('request_failed')
      return
    }

    if (response.status !== 200 && response.status !== 201) {
      logForDebugging(
        `[trusted-device] Enrollment failed ${response.status}: ${jsonStringify(response.data).slice(0, 200)}`,
      )
      reportFail('http_error')
      return
    }

    const token = response.data?.device_token
    if (!token || typeof token !== 'string') {
      logForDebugging(
        '[trusted-device] Enrollment response missing device_token field',
      )
      reportFail('missing_token')
      return
    }

    // 8. Persist + cache invalidate.
    try {
      const secureStorage = getSecureStorage()
      const storageData = secureStorage.read()
      if (!storageData) {
        logForDebugging(
          '[trusted-device] Cannot read storage, skipping token persist',
        )
        reportFail('storage_failed')
        return
      }
      storageData.trustedDeviceToken = token
      const result = secureStorage.update(storageData)
      if (!result.success) {
        logForDebugging(
          `[trusted-device] Failed to persist token: ${result.warning ?? 'unknown'}`,
        )
        reportFail('storage_failed')
        return
      }
      clearTrustedDeviceTokenCache()
      logForDebugging(
        `[trusted-device] Enrolled device_id=${response.data.device_id ?? 'unknown'}`,
      )
      reportSuccess()
    } catch (err: unknown) {
      logForDebugging(
        `[trusted-device] Storage write failed: ${errorMessage(err)}`,
      )
      reportFail('storage_failed')
    }
  } catch (err: unknown) {
    logForDebugging(`[trusted-device] Enrollment error: ${errorMessage(err)}`)
    reportFail('unexpected_error')
  }
}
