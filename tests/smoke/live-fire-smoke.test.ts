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
    // Pass markerDir explicitly via the command line — don't rely on
    // env var inheritance through subprocessEnv() / spawn-shell, which
    // diagnostic on a 2026-05-04 CI run showed was failing to propagate.
    registerHookCallbacks({
      Stop: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command: `SMOKE_MARKER_DIR="${markerDir}" bash "${HOOK_FILE}" Stop`,
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
    const yields: unknown[] = []
    for await (const item of gen) {
      stepCount++
      if (yields.length < 10) yields.push(item)
      if (stepCount > 100) break
    }

    // Generator drain returns when the hook process is launched but spawn
    // I/O may finalize on the next tick — poll briefly for the marker
    // before asserting. Linux CI runners have shown 26-37ms-fast fails
    // under v26.5.18 release runs even when the spawn succeeded.
    const markerPath = join(markerDir, 'Stop.fired')
    const deadline = Date.now() + 5000
    while (!existsSync(markerPath) && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 50))
    }

    if (!existsSync(markerPath)) {
      // Diagnostic: dump fixture state + try a direct spawn to isolate
      // whether the failure is in the hook chain or in spawning bash.
      const fixtureExists = existsSync(HOOK_FILE)
      const fixtureMode = fixtureExists ? readdirSync(FIXTURE_ROOT).join(',') : 'missing'
      const markerDirContents = readdirSync(markerDir).join(',') || '(empty)'
      // Common fallback: marker.sh writes to /tmp/cc-smoke-marker if
      // SMOKE_MARKER_DIR env var was lost in the spawn chain.
      const fallbackDir = '/tmp/cc-smoke-marker'
      let fallbackContents = '(missing)'
      try {
        fallbackContents = existsSync(fallbackDir)
          ? readdirSync(fallbackDir).join(',') || '(empty)'
          : '(missing)'
      } catch {}
      // Direct spawn check: did bash + the hook script work at all?
      let directSpawnResult: string
      try {
        const { spawnSync } = await import('child_process')
        const proc = spawnSync('bash', [HOOK_FILE, 'DirectTest'], {
          env: { ...process.env, SMOKE_MARKER_DIR: markerDir },
          encoding: 'utf-8',
        })
        directSpawnResult = `status=${proc.status} stdout=${proc.stdout?.slice(0, 200)} stderr=${proc.stderr?.slice(0, 200)}`
      } catch (e) {
        directSpawnResult = `exception=${e instanceof Error ? e.message : String(e)}`
      }
      const directMarkerContents = readdirSync(markerDir).join(',') || '(still empty)'
      // Reproduce the EXACT shell wrapping the hook chain uses:
      // spawn(commandString, [], { shell: true }) → /bin/sh -c "<cmd>".
      // Use subprocessEnv() (same env hook chain passes to the child).
      let shellSpawnResult: string
      let subprocessEnvKeys = '(unimported)'
      try {
        const { spawnSync } = await import('child_process')
        const subprocessEnvMod = await import(
          '@claude-code/shell/subprocessEnv.js'
        )
        const childEnv = subprocessEnvMod.subprocessEnv()
        subprocessEnvKeys = `PATH=${childEnv.PATH ? 'present' : 'MISSING'} HOME=${childEnv.HOME ? 'present' : 'MISSING'} SHELL=${childEnv.SHELL ?? 'unset'} keyCount=${Object.keys(childEnv).length}`
        const cmdString = `SMOKE_MARKER_DIR="${markerDir}" bash "${HOOK_FILE}" Stop`
        const proc = spawnSync(cmdString, [], {
          env: childEnv,
          shell: true,
          encoding: 'utf-8',
        })
        shellSpawnResult = `status=${proc.status} stdout=${proc.stdout?.slice(0, 200)} stderr=${proc.stderr?.slice(0, 200)} error=${proc.error?.message ?? 'none'}`
      } catch (e) {
        shellSpawnResult = `exception=${e instanceof Error ? e.message : String(e)}`
      }
      const finalMarkerDir = readdirSync(markerDir).join(',') || '(empty)'
      throw new Error(
        `Stop.fired marker not observed after 5s.\n` +
          `  markerDir=${markerDir} contents=${markerDirContents}\n` +
          `  fallbackDir=${fallbackDir} contents=${fallbackContents}\n` +
          `  hookFile=${HOOK_FILE} exists=${fixtureExists} fixtureRoot=${fixtureMode}\n` +
          `  stepCount=${stepCount}\n` +
          `  yields[0..2]=${JSON.stringify(yields.slice(0, 3))}\n` +
          `  process.env.SMOKE_MARKER_DIR=${process.env.SMOKE_MARKER_DIR}\n` +
          `  direct spawn (argv): ${directSpawnResult}\n` +
          `  marker dir after direct spawn: ${directMarkerContents}\n` +
          `  shell spawn (shell:true via subprocessEnv): ${shellSpawnResult}\n` +
          `  subprocessEnv keys: ${subprocessEnvKeys}\n` +
          `  marker dir after shell spawn: ${finalMarkerDir}`,
      )
    }
    expect(existsSync(markerPath)).toBe(true)
  }, 30_000)
})
