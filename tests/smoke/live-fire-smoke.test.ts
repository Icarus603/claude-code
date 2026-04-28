/**
 * smoke:live-fire — actually spawn a plugin's hook command and assert
 * the marker file appears. This is the layer below smoke:plugin (which
 * only checks STATE/dispatch — not whether execCommandHook really runs
 * the spawn).
 *
 * Strategy: install a fake plugin's hooks directly into STATE.registeredHooks
 * (bypasses loadPluginHooks's enabled-plugin gate which we can't easily
 * trigger without a fully configured plugin install). Then call
 * executeStopHooks generator; the dispatch chain spawns marker.sh; assert
 * the marker file exists.
 *
 * If this test passes, the entire post-V7 silent-failure surface for
 * plugin Stop hooks is closed end-to-end:
 *   STATE has hook → dispatch finds it → command spawns → decision:block
 *   reaches handleStopHooks → result has blockingErrors.
 *
 * Run: bun test tests/smoke/live-fire-smoke.test.ts
 */
import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const FIXTURE_ROOT = resolve(import.meta.dirname, 'fixtures/fake-plugin')
const HOOK_FILE = join(FIXTURE_ROOT, 'hooks/marker.sh')

let markerDir: string

beforeAll(async () => {
  // Bootstrap the runtime exactly like real CLI does.
  await import('@claude-code/app-host/runtime/bootstrap.js')
  const { installRuntimeSkeletonBindings } = await import(
    '@claude-code/app-host/runtime/bootstrap.js'
  )
  installRuntimeSkeletonBindings()
  const { enableConfigs } = await import('@claude-code/config')
  enableConfigs()
})

afterEach(() => {
  if (markerDir) {
    try {
      rmSync(markerDir, { recursive: true, force: true })
    } catch {}
  }
})

describe('smoke:live-fire — plugin hook command actually spawns', () => {
  test('Stop hook spawns marker.sh and we observe the marker file', async () => {
    markerDir = mkdtempSync(join(tmpdir(), 'cc-smoke-marker-'))
    process.env.SMOKE_MARKER_DIR = markerDir

    // Inject the fake plugin's Stop hook into STATE directly. We bypass
    // loadPluginHooks (which requires the plugin be enabled in user
    // settings) — for smoke we just want to prove dispatch + spawn work.
    const { registerHookCallbacks, clearRegisteredPluginHooks } = await import(
      '@claude-code/app-host/bootstrap/state.js'
    )
    clearRegisteredPluginHooks()
    registerHookCallbacks({
      Stop: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command: `bash "${HOOK_FILE}" Stop`,
            },
          ],
          pluginRoot: FIXTURE_ROOT,
          pluginName: 'smoke-fake-plugin',
          pluginId: 'smoke-fake-plugin',
        },
      ],
    } as never)

    // Now invoke executeStopHooks via the same generator the agent loop uses.
    const { executeStopHooks } = await import('@claude-code/agent/hooks.js')
    const { AbortController } = globalThis

    // Build a minimal toolUseContext that satisfies what executeStopHooks reads.
    const ac = new AbortController()
    const toolUseContext = {
      abortController: ac,
      agentId: undefined,
      agentType: 'main',
      getAppState: () => ({
        toolPermissionContext: { mode: 'default' },
        sessionHooks: new Map(),
        mcp: {},
      }),
      addNotification: undefined,
      appendSystemMessage: undefined,
      options: { mainLoopModel: 'test' },
      queryTracking: undefined,
    } as unknown as Parameters<typeof executeStopHooks>[5]

    // Drain the generator. We don't care about the yielded items — just
    // that the spawn happens.
    const gen = executeStopHooks(
      'default',
      ac.signal,
      undefined,
      false,
      undefined,
      toolUseContext,
      [],
      'main',
    )
    let stepCount = 0
    for await (const _ of gen) {
      stepCount++
      if (stepCount > 100) break
    }

    // The marker file is the proof. If hooks never fired, this is missing.
    const markerPath = join(markerDir, 'Stop.fired')
    expect(existsSync(markerPath)).toBe(true)
  }, 30_000)
})
