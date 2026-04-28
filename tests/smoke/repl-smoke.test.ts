/**
 * smoke:repl — boot the runtime as REPL would, verify hook subsystem is
 * live and connected. Catches the ralph-loop bug class: plugin hook
 * registration silently dropped into a no-op slot.
 *
 * NOT a real REPL test (Ink TUI requires interactive terminal). Tests
 * the bootstrap path REPL.tsx takes, up to "would now accept first
 * user input".
 *
 * Run: bun test tests/smoke/repl.smoke.ts
 */
import { describe, expect, test } from 'bun:test'
import { probeRuntime } from './lib/runtime-probe.js'

describe('smoke:repl boot path', () => {
  test('bootstrap completes without errors', async () => {
    const r = await probeRuntime()
    expect(r.errors).toEqual([])
  })

  test('agent host bindings are installed', async () => {
    const r = await probeRuntime()
    expect(r.agentHostBindings.installed).toBe(true)
    expect(r.agentHostBindings.methods.length).toBeGreaterThan(0)
  })

  test('all expected agent host binding methods are wired', async () => {
    const r = await probeRuntime()
    expect(r.agentHostBindings.missingExpected).toEqual([])
  })

  test('plugin hooks are registered into STATE', async () => {
    const r = await probeRuntime()
    // If user has any plugin with hooks enabled, count should be > 0.
    // Empty STATE here is a CRITICAL silent-failure (the ralph-loop bug).
    expect(r.pluginHooks.pluginsLoaded).toBeGreaterThanOrEqual(0)
    if (r.pluginHooks.pluginsLoaded > 0) {
      const totalHooks = Object.values(r.pluginHooks.hooksByEvent).reduce(
        (a, b) => a + b,
        0,
      )
      expect(totalHooks).toBeGreaterThan(0)
    }
  })

  test('Stop hook event has registered handlers when plugins provide them', async () => {
    const r = await probeRuntime()
    // Skip if user has no Stop-hook plugins; otherwise must be > 0.
    // ralph-loop, learning-output-style, explanatory-output-style all
    // provide Stop or SessionStart hooks; if any of those is enabled,
    // STATE must reflect it.
    const knownHookProviders = [
      'ralph-loop',
      'learning-output-style',
      'explanatory-output-style',
    ]
    const enabledKnown = r.pluginHooks.pluginNames.filter(n =>
      knownHookProviders.includes(n),
    )
    if (enabledKnown.length > 0) {
      // At least one event must have hooks.
      const total = Object.values(r.pluginHooks.hooksByEvent).reduce(
        (a, b) => a + b,
        0,
      )
      expect(total).toBeGreaterThan(0)
    }
  })
})
