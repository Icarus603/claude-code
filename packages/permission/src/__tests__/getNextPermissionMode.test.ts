import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// Mock cross-package deps so the unit test stays focused on cycle logic.
const realPermissionSetup = await import('../permissionSetup.js')

let isAutoModeGateEnabledStub = () => false
mock.module('../permissionSetup.js', () => ({
  ...realPermissionSetup,
  isAutoModeGateEnabled: () => isAutoModeGateEnabledStub(),
  getAutoModeUnavailableReason: () => null,
  // transitionPermissionMode pass-through (returns input ctx unchanged for these tests)
  transitionPermissionMode: (
    _from: string,
    _to: string,
    ctx: unknown,
  ) => ctx,
}))

const { getNextPermissionMode } = await import('../getNextPermissionMode.js')

const ORIGINAL_USER_TYPE = process.env.USER_TYPE

beforeEach(() => {
  isAutoModeGateEnabledStub = () => false
  delete process.env.USER_TYPE
})
afterEach(() => {
  if (ORIGINAL_USER_TYPE === undefined) delete process.env.USER_TYPE
  else process.env.USER_TYPE = ORIGINAL_USER_TYPE
})

// Minimal ctx factory so we don't have to construct the full
// ToolPermissionContext shape every test.
function ctx(overrides: Record<string, unknown> = {}): any {
  return {
    mode: 'default',
    isAutoModeAvailable: false,
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  }
}

describe('getNextPermissionMode (non-ant user)', () => {
  test('default → acceptEdits', () => {
    expect(getNextPermissionMode(ctx({ mode: 'default' }))).toBe('acceptEdits')
  })
  test('acceptEdits → plan', () => {
    expect(getNextPermissionMode(ctx({ mode: 'acceptEdits' }))).toBe('plan')
  })
  test('plan → default (when bypass not available)', () => {
    expect(getNextPermissionMode(ctx({ mode: 'plan' }))).toBe('default')
  })
  test('plan → bypassPermissions (when bypass available)', () => {
    expect(
      getNextPermissionMode(
        ctx({ mode: 'plan', isBypassPermissionsModeAvailable: true }),
      ),
    ).toBe('bypassPermissions')
  })
  test('bypassPermissions → default', () => {
    expect(getNextPermissionMode(ctx({ mode: 'bypassPermissions' }))).toBe(
      'default',
    )
  })
  test('dontAsk → default (fallback)', () => {
    expect(getNextPermissionMode(ctx({ mode: 'dontAsk' }))).toBe('default')
  })
  test('unknown mode → default', () => {
    expect(getNextPermissionMode(ctx({ mode: 'someFutureMode' }))).toBe(
      'default',
    )
  })
})

describe('getNextPermissionMode (ant user — auto mode replaces accept/plan)', () => {
  beforeEach(() => {
    process.env.USER_TYPE = 'ant'
  })

  test('default → default (ant, no bypass, no auto)', () => {
    expect(getNextPermissionMode(ctx({ mode: 'default' }))).toBe('default')
  })

  test('default → bypassPermissions (ant, bypass available)', () => {
    expect(
      getNextPermissionMode(
        ctx({ mode: 'default', isBypassPermissionsModeAvailable: true }),
      ),
    ).toBe('bypassPermissions')
  })

  // Auto-mode entry tests need feature('TRANSCRIPT_CLASSIFIER') to be true,
  // but bun:bundle's feature() is off in `bun test` (no STABLE_FEATURES
  // defines applied). The auto path is therefore unreachable here — any
  // call site that would have returned 'auto' falls through to 'default'.
  // We assert that fall-through behavior so the test is meaningful in the
  // current runtime mode.

  test('default → default (ant, no bypass, auto path unreachable in test mode)', () => {
    isAutoModeGateEnabledStub = () => true
    expect(
      getNextPermissionMode(
        ctx({ mode: 'default', isAutoModeAvailable: true }),
      ),
    ).toBe('default')
  })

  test('default → default (ant, auto context flag set but gate disabled)', () => {
    isAutoModeGateEnabledStub = () => false
    expect(
      getNextPermissionMode(
        ctx({ mode: 'default', isAutoModeAvailable: true }),
      ),
    ).toBe('default')
  })
})

describe('cycle entry from plan/bypass (auto path unreachable in test mode)', () => {
  beforeEach(() => {
    isAutoModeGateEnabledStub = () => true
  })

  test('plan → default when no bypass available', () => {
    expect(
      getNextPermissionMode(
        ctx({ mode: 'plan', isAutoModeAvailable: true }),
      ),
    ).toBe('default')
  })

  test('bypassPermissions → default', () => {
    expect(
      getNextPermissionMode(
        ctx({ mode: 'bypassPermissions', isAutoModeAvailable: true }),
      ),
    ).toBe('default')
  })

  test('plan → bypassPermissions when bypass available', () => {
    expect(
      getNextPermissionMode(
        ctx({
          mode: 'plan',
          isBypassPermissionsModeAvailable: true,
          isAutoModeAvailable: true,
        }),
      ),
    ).toBe('bypassPermissions')
  })
})
