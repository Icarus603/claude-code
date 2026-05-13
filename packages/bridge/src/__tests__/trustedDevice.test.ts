/**
 * Tests for trustedDevice.ts — byte-for-byte port-correctness against
 * ant v2.1.136 3157.js (`tN` module).
 *
 * Pin:
 *   - `wgH` (isTrustedDeviceGateEnabled) — both gate AND policy must be on
 *   - `kJ8` (clearTrustedDeviceToken) — proactive-disabled SKIPS clearing
 *     (preserves token during enrollment-endpoint outage)
 *   - `t66` (isTrustedDeviceUnenrolled) — gate-gated predicate
 *   - `U$5` (getTrustedDeviceUnenrolledReason) — proactive-disabled vs
 *     standard message selection
 *   - `PRH` (getTrustedDeviceToken) — gate-gated read
 *   - `CLAUDE_TRUSTED_DEVICE_TOKEN` env-var precedence in readStored*
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import * as realFlags from '@claude-code/config/feature-flags'
import * as realPolicy from '@claude-code/provider/policyLimits/index.js'
import * as realStorage from '@claude-code/storage/secureStorage.js'

// ---- Mock feature flags ----
type GateMap = Record<string, boolean>
const flagState: { gates: GateMap; policy: Record<string, boolean> } = {
  gates: {},
  policy: {},
}

mock.module('@claude-code/config/feature-flags', () => ({
  ...realFlags,
  getFeatureValue_CACHED_MAY_BE_STALE: (
    name: string,
    fallback: boolean,
  ): boolean => flagState.gates[name] ?? fallback,
  checkGate_CACHED_OR_BLOCKING: async (name: string): Promise<boolean> =>
    flagState.gates[name] ?? false,
}))

mock.module('@claude-code/provider/policyLimits/index.js', () => ({
  ...realPolicy,
  isPolicyAllowed: (name: string): boolean =>
    flagState.policy[name] ?? true, // fail-open like ant
  waitForPolicyLimitsToLoad: async () => {},
}))

// ---- Mock secureStorage so keychain isn't actually touched ----
type StorageShape = { trustedDeviceToken?: string; [k: string]: unknown }
const storageState: { data: StorageShape | null } = { data: {} }

mock.module('@claude-code/storage/secureStorage.js', () => ({
  ...realStorage,
  getSecureStorage: () => ({
    read: () =>
      storageState.data === null
        ? null
        : ({ ...storageState.data } as StorageShape),
    update: (data: StorageShape) => {
      storageState.data = { ...data }
      return { success: true }
    },
  }),
}))

const {
  clearTrustedDeviceToken,
  clearTrustedDeviceTokenCache,
  getTrustedDeviceToken,
  getTrustedDeviceUnenrolledReason,
  isTrustedDeviceUnenrolled,
  PROACTIVE_ENROLLMENT_DISABLED_MESSAGE,
  TRUSTED_DEVICE_UNENROLLED_MESSAGE,
} = await import('../trustedDevice.js')

const GATE = 'tengu_sessions_elevated_auth_enforcement'
const PROACTIVE_DISABLE_GATE =
  'tengu_sessions_elevated_auth_disable_proactive_enrollment'
const POLICY = 'require_trusted_devices'

beforeEach(() => {
  flagState.gates = {}
  flagState.policy = {}
  storageState.data = {}
  delete process.env.CLAUDE_TRUSTED_DEVICE_TOKEN
  clearTrustedDeviceTokenCache()
})

afterEach(() => {
  delete process.env.CLAUDE_TRUSTED_DEVICE_TOKEN
})

describe('isTrustedDeviceGateEnabled (ant wgH)', () => {
  test('returns false when GrowthBook gate is off, regardless of policy', () => {
    flagState.gates[GATE] = false
    flagState.policy[POLICY] = true
    storageState.data = { trustedDeviceToken: 'x' }
    expect(getTrustedDeviceToken()).toBeUndefined()
  })

  test('returns false when gate is on but org policy denies', () => {
    flagState.gates[GATE] = true
    flagState.policy[POLICY] = false
    storageState.data = { trustedDeviceToken: 'x' }
    expect(getTrustedDeviceToken()).toBeUndefined()
  })

  test('returns token when both gate AND policy are on', () => {
    flagState.gates[GATE] = true
    flagState.policy[POLICY] = true
    storageState.data = { trustedDeviceToken: 'x' }
    expect(getTrustedDeviceToken()).toBe('x')
  })

  test('policy absent (undefined) defaults to allow (fail-open)', () => {
    flagState.gates[GATE] = true
    // policy NOT set → isPolicyAllowed returns true by ant convention
    storageState.data = { trustedDeviceToken: 'x' }
    expect(getTrustedDeviceToken()).toBe('x')
  })
})

describe('readStoredTrustedDeviceToken — env-var precedence', () => {
  test('CLAUDE_TRUSTED_DEVICE_TOKEN env var shadows keychain', () => {
    flagState.gates[GATE] = true
    storageState.data = { trustedDeviceToken: 'from-keychain' }
    process.env.CLAUDE_TRUSTED_DEVICE_TOKEN = 'from-env'
    clearTrustedDeviceTokenCache()
    expect(getTrustedDeviceToken()).toBe('from-env')
  })
})

describe('isTrustedDeviceUnenrolled (ant t66)', () => {
  test('returns false when gate is off (no enforcement applies)', () => {
    flagState.gates[GATE] = false
    expect(isTrustedDeviceUnenrolled()).toBe(false)
  })

  test('returns false when gate is on AND token present', () => {
    flagState.gates[GATE] = true
    storageState.data = { trustedDeviceToken: 'x' }
    expect(isTrustedDeviceUnenrolled()).toBe(false)
  })

  test('returns true when gate is on AND token absent', () => {
    flagState.gates[GATE] = true
    storageState.data = {}
    expect(isTrustedDeviceUnenrolled()).toBe(true)
  })
})

describe('getTrustedDeviceUnenrolledReason (ant U$5)', () => {
  test('returns null when gate is off', () => {
    flagState.gates[GATE] = false
    expect(getTrustedDeviceUnenrolledReason()).toBeNull()
  })

  test('returns null when device is enrolled', () => {
    flagState.gates[GATE] = true
    storageState.data = { trustedDeviceToken: 'x' }
    expect(getTrustedDeviceUnenrolledReason()).toBeNull()
  })

  test('returns proactive-disabled message when kill-switch is on', () => {
    flagState.gates[GATE] = true
    flagState.gates[PROACTIVE_DISABLE_GATE] = true
    storageState.data = {}
    expect(getTrustedDeviceUnenrolledReason()).toBe(
      PROACTIVE_ENROLLMENT_DISABLED_MESSAGE,
    )
  })

  test('returns standard message when no kill-switch', () => {
    flagState.gates[GATE] = true
    storageState.data = {}
    expect(getTrustedDeviceUnenrolledReason()).toBe(
      TRUSTED_DEVICE_UNENROLLED_MESSAGE,
    )
  })
})

describe('clearTrustedDeviceToken (ant kJ8) — kill-switch override', () => {
  test('SKIPS clearing when proactive disable gate is ON (outage guard)', () => {
    // This is the critical ant invariant: during an enrollment outage,
    // we must NOT clear an existing token, because the user has no way
    // to re-enroll until the outage ends. ccb's old impl checked the
    // wrong condition and could blow away tokens in this scenario.
    flagState.gates[PROACTIVE_DISABLE_GATE] = true
    storageState.data = { trustedDeviceToken: 'preserve-me' }
    clearTrustedDeviceToken()
    expect(storageState.data?.trustedDeviceToken).toBe('preserve-me')
  })

  test('clears token when kill-switch is off', () => {
    flagState.gates[PROACTIVE_DISABLE_GATE] = false
    storageState.data = {
      trustedDeviceToken: 'remove-me',
      other: 'preserve',
    }
    clearTrustedDeviceToken()
    expect(storageState.data?.trustedDeviceToken).toBeUndefined()
    expect(storageState.data?.other).toBe('preserve')
  })

  test('no-op when storage is unavailable (read returns null)', () => {
    storageState.data = null
    expect(() => clearTrustedDeviceToken()).not.toThrow()
  })

  test('does NOT key off the GrowthBook gate (clearing must work even when off)', () => {
    // ant kJ8 explicitly avoids gating the clear by `wgH` — if the gate
    // flipped from on→off between sessions, we still need to clean up
    // the stale token from the keychain.
    flagState.gates[GATE] = false
    storageState.data = { trustedDeviceToken: 'stale' }
    clearTrustedDeviceToken()
    expect(storageState.data?.trustedDeviceToken).toBeUndefined()
  })
})
