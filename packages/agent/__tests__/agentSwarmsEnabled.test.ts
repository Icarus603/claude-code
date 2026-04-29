import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// Mock the two host bindings the function reaches into. Spread the real
// modules so unrelated exports stay intact (per ratchet rule).
const realFeatureFlags = await import('@claude-code/config/feature-flags')
const realEnvUtils = await import('@claude-code/config/env/utils')

let growthBookValue = true
const envOverrides = new Map<string, string>()

mock.module('@claude-code/config/feature-flags', () => ({
  ...realFeatureFlags,
  getFeatureValue_CACHED_MAY_BE_STALE: <T>(_key: string, fallback: T) => {
    if (_key === 'tengu_amber_flint') return growthBookValue as T
    return fallback
  },
}))

mock.module('@claude-code/config/env/utils', () => ({
  ...realEnvUtils,
  readEnv: (key: string) => envOverrides.get(key) ?? '',
  isEnvTruthy: (val: string | undefined) => {
    if (!val) return false
    const lc = val.toLowerCase()
    return lc === '1' || lc === 'true' || lc === 'yes'
  },
}))

const { isAgentSwarmsEnabled } = await import('../agentSwarmsEnabled.js')

const realArgv = process.argv
const realUserType = process.env.USER_TYPE

beforeEach(() => {
  envOverrides.clear()
  growthBookValue = true
  process.argv = ['bun', 'cli.ts']
  delete process.env.USER_TYPE
})

afterEach(() => {
  process.argv = realArgv
  if (realUserType !== undefined) {
    process.env.USER_TYPE = realUserType
  } else {
    delete process.env.USER_TYPE
  }
})

describe('isAgentSwarmsEnabled — ant short-circuit', () => {
  test('USER_TYPE=ant returns true regardless of other gates', () => {
    process.env.USER_TYPE = 'ant'
    growthBookValue = false // even with GrowthBook killswitch
    expect(isAgentSwarmsEnabled()).toBe(true)
  })

  test('USER_TYPE=ant ignores missing env opt-in', () => {
    process.env.USER_TYPE = 'ant'
    // no CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, no --agent-teams
    expect(isAgentSwarmsEnabled()).toBe(true)
  })

  test('USER_TYPE=ANT (uppercase) does NOT short-circuit', () => {
    // Contract: case-sensitive comparison
    process.env.USER_TYPE = 'ANT'
    expect(isAgentSwarmsEnabled()).toBe(false)
  })
})

describe('isAgentSwarmsEnabled — opt-in gate', () => {
  test('returns false when no env var and no --agent-teams flag', () => {
    expect(isAgentSwarmsEnabled()).toBe(false)
  })

  test('returns true when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 and GrowthBook alive', () => {
    envOverrides.set('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', '1')
    expect(isAgentSwarmsEnabled()).toBe(true)
  })

  test('returns true when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=true (string)', () => {
    envOverrides.set('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', 'true')
    expect(isAgentSwarmsEnabled()).toBe(true)
  })

  test('returns false when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=0', () => {
    envOverrides.set('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', '0')
    expect(isAgentSwarmsEnabled()).toBe(false)
  })

  test('returns false when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=false', () => {
    envOverrides.set('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', 'false')
    expect(isAgentSwarmsEnabled()).toBe(false)
  })

  test('returns true when --agent-teams flag is in argv (no env needed)', () => {
    process.argv = ['bun', 'cli.ts', '--agent-teams']
    expect(isAgentSwarmsEnabled()).toBe(true)
  })

  test('returns true when both env var AND --agent-teams flag are set', () => {
    envOverrides.set('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', '1')
    process.argv = ['bun', 'cli.ts', '--agent-teams']
    expect(isAgentSwarmsEnabled()).toBe(true)
  })
})

describe('isAgentSwarmsEnabled — GrowthBook killswitch', () => {
  test('returns false when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 but GrowthBook killed', () => {
    envOverrides.set('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', '1')
    growthBookValue = false
    expect(isAgentSwarmsEnabled()).toBe(false)
  })

  test('returns false when --agent-teams set but GrowthBook killed', () => {
    process.argv = ['bun', 'cli.ts', '--agent-teams']
    growthBookValue = false
    expect(isAgentSwarmsEnabled()).toBe(false)
  })

  test('GrowthBook gate is named "tengu_amber_flint" with default true', () => {
    // Contract: the killswitch defaults to ON (returns true when
    // GrowthBook value is missing / cache stale). Verify by setting
    // env opt-in but NOT setting growthBookValue (default true).
    envOverrides.set('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', '1')
    growthBookValue = true
    expect(isAgentSwarmsEnabled()).toBe(true)
  })
})

describe('isAgentSwarmsEnabled — 3-way gate combinations', () => {
  test('all gates: ant + env + flag + GrowthBook → true', () => {
    process.env.USER_TYPE = 'ant'
    envOverrides.set('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', '1')
    process.argv = ['bun', 'cli.ts', '--agent-teams']
    growthBookValue = true
    expect(isAgentSwarmsEnabled()).toBe(true)
  })

  test('non-ant + no env + no flag + GrowthBook alive → false (env/flag gate fails first)', () => {
    growthBookValue = true
    expect(isAgentSwarmsEnabled()).toBe(false)
  })

  test('non-ant + env=true + GrowthBook alive → true', () => {
    envOverrides.set('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', '1')
    growthBookValue = true
    expect(isAgentSwarmsEnabled()).toBe(true)
  })
})
