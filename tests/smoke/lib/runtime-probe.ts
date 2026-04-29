/**
 * Runtime probe for smoke tests.
 *
 * Boot the same code path the real CLI takes (app-host bootstrap +
 * install*Bindings), then run `loadPluginHooks()` and inspect the
 * resulting STATE directly. No subprocess, no API call.
 *
 * The point: catch silent-failure bugs at the boundary between
 * "wires declared" and "wires connected". For each subsystem we
 * dump the relevant STATE so tests can assert on it.
 */

interface RuntimeProbeReport {
  pluginHooks: {
    pluginsLoaded: number
    hooksByEvent: Record<string, number>
    pluginNames: string[]
  }
  agentHostBindings: {
    installed: boolean
    methods: string[] // names of methods present
    missingExpected: string[] // expected methods that are undefined
  }
  /**
   * Per hook event, what dispatchable hooks does the runtime see?
   * matched=-1 means getMatchingHooks threw. matched=0 with a known
   * plugin in pluginNames is the "STATE has it but dispatch can't
   * see it" silent-failure class.
   */
  dispatch: Record<string, { matched: number; pluginNames: string[] }>
  errors: string[]
}

export async function probeRuntime(): Promise<RuntimeProbeReport> {
  const errors: string[] = []
  const report: RuntimeProbeReport = {
    pluginHooks: { pluginsLoaded: 0, hooksByEvent: {}, pluginNames: [] },
    agentHostBindings: { installed: false, methods: [], missingExpected: [] },
    dispatch: {},
    errors,
  }

  // Bootstrap (this is what packages/cli/src/entry/main.tsx does at the top).
  try {
    await import('@claude-code/app-host/runtime/bootstrap.js')
  } catch (e) {
    errors.push(`bootstrap import failed: ${(e as Error).message}`)
    return report
  }

  // Force the host bindings install path the way main.tsx does.
  try {
    const { installRuntimeSkeletonBindings } = await import(
      '@claude-code/app-host/runtime/bootstrap.js'
    )
    installRuntimeSkeletonBindings()
  } catch (e) {
    errors.push(
      `installRuntimeSkeletonBindings failed: ${(e as Error).message}`,
    )
  }

  // enableConfigs (config/plugin code paths require this).
  try {
    const { enableConfigs } = await import('@claude-code/config')
    enableConfigs()
  } catch (e) {
    errors.push(`enableConfigs failed: ${(e as Error).message}`)
  }

  // Load plugin hooks (this is what processSessionStartHooks does).
  try {
    const { loadPluginHooks } = await import(
      '@claude-code/config/plugin/loadPluginHooks'
    )
    await loadPluginHooks()
  } catch (e) {
    errors.push(`loadPluginHooks failed: ${(e as Error).message}`)
  }

  // Now read back what STATE actually has.
  try {
    const { getRegisteredHooks } = await import(
      '@claude-code/app-host/bootstrap/state.js'
    )
    const hooks = getRegisteredHooks() as Record<string, unknown[]> | null
    if (hooks) {
      for (const [event, list] of Object.entries(hooks)) {
        if (Array.isArray(list) && list.length > 0) {
          report.pluginHooks.hooksByEvent[event] = list.length
          for (const m of list) {
            const name = (m as { pluginName?: string }).pluginName
            if (name && !report.pluginHooks.pluginNames.includes(name)) {
              report.pluginHooks.pluginNames.push(name)
            }
          }
        }
      }
    }
  } catch (e) {
    errors.push(`getRegisteredHooks failed: ${(e as Error).message}`)
  }

  try {
    const { loadAllPluginsCacheOnly } = await import(
      '@claude-code/config/plugin/pluginLoader'
    )
    const result = await loadAllPluginsCacheOnly()
    report.pluginHooks.pluginsLoaded = result.enabled?.length ?? 0
  } catch (e) {
    errors.push(`loadAllPluginsCacheOnly failed: ${(e as Error).message}`)
  }

  // Agent host bindings.
  try {
    const { getAgentHostBindings } = await import('@claude-code/agent')
    const bindings = getAgentHostBindings() as Record<string, unknown>
    report.agentHostBindings.installed = true
    report.agentHostBindings.methods = Object.keys(bindings).filter(k => {
      try {
        return typeof (bindings as Record<string, unknown>)[k] === 'function'
      } catch {
        return false
      }
    })
    // Methods we EXPECT to be wired (subset of agentHostBindings.ts).
    // executePreCompactHooks is NOT in this list — it's imported directly
    // from `@claude-code/agent/hooks.js` by intra-package callers (see
    // command-runtime/commands/compact/compact.ts) and doesn't require a
    // host binding. Only hooks consumed across package boundaries via
    // internal/stopHooksCore.ts go through the host binding indirection.
    const expected = [
      'executeStopHooks',
      'executeTaskCompletedHooks',
      'executeTeammateIdleHooks',
      'createUserMessage',
      'createAttachmentMessage',
      'getStopHookMessage',
      'getSessionId',
      'getProjectRoot',
    ]
    for (const name of expected) {
      const v = (bindings as Record<string, unknown>)[name]
      if (typeof v !== 'function') {
        report.agentHostBindings.missingExpected.push(name)
      }
    }
  } catch (e) {
    errors.push(`agent host bindings probe failed: ${(e as Error).message}`)
  }

  // Dispatch probe — for each event we care about, ask getMatchingHooks
  // whether it can find any dispatchable matchers. This goes one layer
  // deeper than just reading STATE: it exercises hookSettings → matcher
  // resolution → trust check, the same path the real dispatcher takes.
  try {
    const { getMatchingHooks } = await import('@claude-code/agent/hooks.js')
    const eventStubInputs: Array<[string, Record<string, unknown>]> = [
      ['Stop', { hook_event_name: 'Stop', stop_hook_active: false }],
      [
        'SubagentStop',
        {
          hook_event_name: 'SubagentStop',
          stop_hook_active: false,
          agent_id: 'probe-stub',
          agent_type: 'probe',
          agent_transcript_path: '',
        },
      ],
      ['SessionStart', { hook_event_name: 'SessionStart', source: 'startup' }],
      [
        'PreToolUse',
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: {},
          tool_use_id: 'probe',
        },
      ],
      [
        'UserPromptSubmit',
        { hook_event_name: 'UserPromptSubmit', prompt: 'probe' },
      ],
      ['PreCompact', { hook_event_name: 'PreCompact', trigger: 'auto' }],
      [
        'Notification',
        { hook_event_name: 'Notification', notification_type: 'probe' },
      ],
    ]
    for (const [event, input] of eventStubInputs) {
      try {
        const matched = await getMatchingHooks(
          undefined,
          'probe-session',
          event as never,
          input as never,
          undefined,
        )
        const arr = (matched as Array<{ pluginName?: string }>) ?? []
        report.dispatch[event] = {
          matched: arr.length,
          pluginNames: Array.from(
            new Set(arr.map(m => m.pluginName ?? '<no-plugin>')),
          ),
        }
      } catch (e) {
        report.dispatch[event] = { matched: -1, pluginNames: [] }
        errors.push(`getMatchingHooks(${event}) threw: ${(e as Error).message}`)
      }
    }
  } catch (e) {
    errors.push(`dispatch probe import failed: ${(e as Error).message}`)
  }

  return report
}
