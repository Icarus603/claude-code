import { describe, expect, mock, test } from 'bun:test'

// Mock @claude-code/config so getGlobalConfig returns whatever each test
// needs. shouldFireBanner is pure beyond this read; nothing else stubbed.
// Spread real exports first — bun's mock.module is process-wide replacement
// (see feedback_bun_mock_module_global_scope.md), incomplete mocks pollute
// other modules in the test run.
const realConfig = await import('@claude-code/config')

type Cfg = ReturnType<typeof realConfig.getGlobalConfig>

// Snapshot the real default ONCE before installing the mock — calling the
// real getGlobalConfig from inside the mock (e.g. via `...realConfig.getGlobalConfig()`)
// would recurse through the mock itself (mock.module replaces the binding
// process-wide).
const realDefault: Cfg = realConfig.getGlobalConfig()

let configOverride: Partial<Cfg> = {}
mock.module('@claude-code/config', () => ({
  ...realConfig,
  getGlobalConfig: (): Cfg => ({
    ...realDefault,
    ...configOverride,
  }),
}))

const { shouldFireBanner } = await import('../notificationPolicy.js')

function withConfig(overrides: Partial<Cfg>) {
  configOverride = overrides
}

describe('shouldFireBanner', () => {
  test('disabled channel mutes everything including auth_success', () => {
    withConfig({
      preferredNotifChannel: 'notifications_disabled',
      agentPushNotifEnabled: true,
      inputNeededNotifEnabled: true,
    })
    expect(shouldFireBanner('permission_prompt')).toBe(false)
    expect(shouldFireBanner('push_notification')).toBe(false)
    expect(shouldFireBanner('auth_success')).toBe(false)
    expect(shouldFireBanner('idle_prompt')).toBe(false)
  })

  test('action_required gated by inputNeededNotifEnabled', () => {
    withConfig({
      preferredNotifChannel: 'auto',
      agentPushNotifEnabled: true,
      inputNeededNotifEnabled: false,
    })
    expect(shouldFireBanner('permission_prompt')).toBe(false)
    expect(shouldFireBanner('elicitation_dialog')).toBe(false)
    expect(shouldFireBanner('elicitation_url_dialog')).toBe(false)
    expect(shouldFireBanner('worker_permission_prompt')).toBe(false)
    expect(shouldFireBanner('idle_prompt')).toBe(false)
  })

  test('action_required allowed when inputNeededNotifEnabled is true', () => {
    withConfig({
      preferredNotifChannel: 'auto',
      agentPushNotifEnabled: false,
      inputNeededNotifEnabled: true,
    })
    expect(shouldFireBanner('permission_prompt')).toBe(true)
    expect(shouldFireBanner('elicitation_dialog')).toBe(true)
    expect(shouldFireBanner('elicitation_url_dialog')).toBe(true)
    expect(shouldFireBanner('worker_permission_prompt')).toBe(true)
    expect(shouldFireBanner('idle_prompt')).toBe(true)
  })

  test('claude_decision gated by agentPushNotifEnabled', () => {
    withConfig({
      preferredNotifChannel: 'auto',
      agentPushNotifEnabled: false,
      inputNeededNotifEnabled: true,
    })
    expect(shouldFireBanner('push_notification')).toBe(false)
  })

  test('claude_decision allowed when agentPushNotifEnabled is true', () => {
    withConfig({
      preferredNotifChannel: 'auto',
      agentPushNotifEnabled: true,
      inputNeededNotifEnabled: false,
    })
    expect(shouldFireBanner('push_notification')).toBe(true)
  })

  test('auth_success always allowed when channel is not disabled', () => {
    withConfig({
      preferredNotifChannel: 'auto',
      agentPushNotifEnabled: false,
      inputNeededNotifEnabled: false,
    })
    expect(shouldFireBanner('auth_success')).toBe(true)
  })

  test('unknown notificationType falls through to "always" bucket', () => {
    withConfig({
      preferredNotifChannel: 'auto',
      agentPushNotifEnabled: false,
      inputNeededNotifEnabled: false,
    })
    expect(shouldFireBanner('some_future_event_type_not_yet_categorized')).toBe(true)
  })

  test('undefined toggle treated as off (default)', () => {
    withConfig({
      preferredNotifChannel: 'auto',
      agentPushNotifEnabled: undefined,
      inputNeededNotifEnabled: undefined,
    })
    expect(shouldFireBanner('permission_prompt')).toBe(false)
    expect(shouldFireBanner('push_notification')).toBe(false)
  })
})
