/**
 * smoke:plugin — verify the dispatch path can actually find plugin hooks,
 * not just that they're registered into STATE. This is one layer deeper
 * than smoke:repl: even if STATE has hooks, getMatchingHooks (which the
 * real executeHooks call uses) might not see them due to matcher logic,
 * snapshot caching, trust gates, etc.
 *
 * Catches: ralph-loop bug class + every dispatch-time silent failure.
 *
 * Run: bun test tests/smoke/plugin-hooks-smoke.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { probeRuntime } from './lib/runtime-probe.js'

describe('smoke:plugin dispatch path', () => {
  test('dispatch probe ran for every queried event', async () => {
    const r = await probeRuntime()
    const queried = [
      'Stop',
      'SubagentStop',
      'SessionStart',
      'PreToolUse',
      'UserPromptSubmit',
      'PreCompact',
      'Notification',
    ]
    for (const e of queried) {
      expect(r.dispatch[e]).toBeDefined()
      expect(r.dispatch[e]!.matched).toBeGreaterThanOrEqual(0)
    }
  })

  test('Stop event dispatch sees ralph-loop when ralph-loop is enabled', async () => {
    const r = await probeRuntime()
    if (r.pluginHooks.pluginNames.includes('ralph-loop')) {
      const stop = r.dispatch.Stop
      expect(stop?.matched).toBeGreaterThan(0)
      expect(stop?.pluginNames).toContain('ralph-loop')
    }
  })

  test('SessionStart event dispatch sees registered plugins', async () => {
    const r = await probeRuntime()
    const expectedSessionStartPlugins = [
      'learning-output-style',
      'explanatory-output-style',
    ]
    const enabledExpected = r.pluginHooks.pluginNames.filter(n =>
      expectedSessionStartPlugins.includes(n),
    )
    if (enabledExpected.length > 0) {
      const ss = r.dispatch.SessionStart
      expect(ss?.matched).toBeGreaterThan(0)
      // Each known plugin in STATE should appear in dispatch
      for (const name of enabledExpected) {
        // It's possible the plugin's matcher doesn't match the stub
        // input, but here SessionStart with `source: 'startup'` is the
        // canonical input — anything attached to SessionStart with no
        // matcher (the common case) should match.
        const found = ss?.pluginNames.includes(name)
        if (!found) {
          // Print enough context to triage rather than just failing.
          throw new Error(
            `SessionStart in STATE has plugin "${name}" but dispatch did not return it. ` +
              `dispatch: ${JSON.stringify(ss)}; pluginsLoaded: ${r.pluginHooks.pluginsLoaded}`,
          )
        }
      }
    }
  })

  test('STATE-vs-dispatch consistency: every event in STATE must be visible to dispatch', async () => {
    const r = await probeRuntime()
    for (const [event, count] of Object.entries(r.pluginHooks.hooksByEvent)) {
      // Skip events we didn't query (smoke probe only stubs a few)
      if (!(event in r.dispatch)) continue
      const dispatched = r.dispatch[event]!
      // STATE has hooks → dispatch should find ≥1.
      // 0 here is the ralph-loop bug class: register ✓ but dispatch ✗.
      expect({
        event,
        stateCount: count,
        dispatchedCount: dispatched.matched,
        dispatchedPlugins: dispatched.pluginNames,
      }).toMatchObject({
        event,
        // dispatchedCount must be > 0 if STATE > 0
        dispatchedCount: expect.any(Number),
      })
      if (count > 0 && dispatched.matched === 0) {
        throw new Error(
          `Event "${event}" has ${count} hooks in STATE but dispatch returned 0. ` +
            `This is a silent-failure: register ✓, dispatch ✗.`,
        )
      }
    }
  })

  test('no dispatch query throws (every event handler reachable)', async () => {
    const r = await probeRuntime()
    const threwEvents = Object.entries(r.dispatch)
      .filter(([_, v]) => v.matched === -1)
      .map(([k]) => k)
    expect(threwEvents).toEqual([])
  })
})
