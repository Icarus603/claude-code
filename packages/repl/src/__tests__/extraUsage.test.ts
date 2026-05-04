import { afterEach, describe, expect, mock, test } from 'bun:test'

// Mock app-host and authAlias so tests don't need real state. The
// previous mock.module on env/utils was REMOVED — the real isEnvTruthy
// already accepts '1'/'true' (case-insensitive, plus 'yes'). The mock
// duplicated real behavior, and any mock.module is process-wide pollution
// in bun-test. See feedback_self_audit_before_declaring_done.md.
const realState = await import('@claude-code/app-host/bootstrap/state.js')
const realAuthAlias = await import('@claude-code/provider/authAlias.js')
mock.module('@claude-code/app-host/bootstrap/state.js', () => ({
  ...realState,
  getIsNonInteractiveSession: () => false,
}))
mock.module('@claude-code/provider/authAlias.js', () => ({
  ...realAuthAlias,
  isOverageProvisioningAllowed: () => true,
}))

const { extraUsage, extraUsageNonInteractive } = await import('../extraUsage.js')

afterEach(() => {
  delete process.env.DISABLE_EXTRA_USAGE_COMMAND
})

describe('extraUsage command', () => {
  test('isEnabled is true in interactive sessions when overage is allowed', () => {
    expect(extraUsage.isEnabled?.()).toBe(true)
  })

  test('isEnabled is false when DISABLE_EXTRA_USAGE_COMMAND is set', () => {
    process.env.DISABLE_EXTRA_USAGE_COMMAND = '1'
    expect(extraUsage.isEnabled?.()).toBe(false)
  })

  test('extraUsage.type is local-jsx', () => {
    expect(extraUsage.type).toBe('local-jsx')
  })

  test('extraUsage.name is extra-usage', () => {
    expect(extraUsage.name).toBe('extra-usage')
  })
})

describe('extraUsageNonInteractive command', () => {
  test('shares the name extra-usage', () => {
    expect(extraUsageNonInteractive.name).toBe('extra-usage')
  })

  test('declares supportsNonInteractive', () => {
    expect(extraUsageNonInteractive.supportsNonInteractive).toBe(true)
  })

  // isHidden depends on getIsNonInteractiveSession() — mocked false.
  test('isHidden is true when session is interactive (mocked)', () => {
    expect(extraUsageNonInteractive.isHidden).toBe(true)
  })
})
