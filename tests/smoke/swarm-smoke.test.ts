/**
 * smoke:swarm — verify swarm/teammate subsystem boots and exposes its
 * primary state functions. Same pattern as the hook STATE bug:
 * agentHostBindings.ts has require('@claude-code/swarm/teammateState.js')
 * for isTeammate / getAgentName / getTeamName, so if those aren't wired
 * (or aren't loadable), the agent loop's stop-hook chain will silently
 * misbehave for teammate sessions.
 *
 * Run: bun test tests/smoke/swarm-smoke.test.ts
 */
import { describe, expect, test } from 'bun:test'

describe('smoke:swarm boot', () => {
  test('swarm package teammateState module loads', async () => {
    const mod = await import('@claude-code/swarm/teammateState.js')
    expect(typeof mod.isTeammate).toBe('function')
    expect(typeof mod.getAgentName).toBe('function')
    expect(typeof mod.getTeamName).toBe('function')
  })

  test('teammate state default values are sane', async () => {
    const { isTeammate, getAgentName, getTeamName } = await import(
      '@claude-code/swarm/teammateState.js'
    )
    // In a fresh process with no swarm session, these should be safe defaults
    // (false / undefined). Throwing here means a binding wasn't wired.
    expect(() => isTeammate()).not.toThrow()
    expect(() => getAgentName()).not.toThrow()
    expect(() => getTeamName()).not.toThrow()
    expect(isTeammate()).toBe(false)
    expect(getAgentName()).toBeUndefined()
    expect(getTeamName()).toBeUndefined()
  })

  test('agentHostBindings teammate wires resolve to functions', async () => {
    await import('@claude-code/app-host/runtime/bootstrap.js')
    const { installRuntimeSkeletonBindings } = await import(
      '@claude-code/app-host/runtime/bootstrap.js'
    )
    installRuntimeSkeletonBindings()

    const { getAgentHostBindings } = await import('@claude-code/agent')
    const b = getAgentHostBindings() as Record<string, unknown>
    // Per agentHostBindings.ts wires for swarm
    expect(typeof b.isTeammate).toBe('function')
    expect(typeof b.getAgentName).toBe('function')
    expect(typeof b.getTeamName).toBe('function')
  })

  test('mailbox module loads without error', async () => {
    const mod = await import('@claude-code/swarm')
    // V7 mailbox API surface from agentHostBindings.ts dispatch.
    // Just verifying module loads — calling these without a real session
    // would be an integration test, not a smoke test.
    expect(mod).toBeDefined()
    // These are required for stop hook teammate flows
    const requiredExports = [
      'isIdleNotification',
      'isShutdownApproved',
      'isStructuredProtocolMessage',
      'markMessagesAsReadByPredicate',
      'readUnreadMessages',
      'removeTeammateFromTeamFile',
    ]
    for (const name of requiredExports) {
      expect(
        typeof (mod as Record<string, unknown>)[name],
        `swarm.${name} should be a function`,
      ).toBe('function')
    }
  })
})
