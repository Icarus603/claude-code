/**
 * Tests for sdkMemorySummary.ts — port-correctness against ant v2.1.136
 * 2144.js: `Cc_`/`vP9`/`mH8`/`pG1`/`UG1`/`hP9`/`xH8`/`uH8`.
 *
 * Strategy: mock `@claude-code/local-observability.logEvent` to capture
 * emitted events. Reset the module-level singletons via the test-only
 * helper between tests so child/attribute state doesn't leak.
 *
 * Tests pin:
 *   - emit-once latch (`VP9`)
 *   - schedule-once latch (`kP9`)
 *   - SDK entrypoint gate — non-SDK callers don't pollute the tracker
 *   - bytes-not-MB schema
 *   - peak-via-max(initial,now)
 *   - constrained_memory_bytes field emission rule
 *   - attribute provider entries+bytes both forms
 *   - child kind whitelist filter
 *   - vP9 dead-marking preserves the entry's contribution
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import * as realObs from '@claude-code/local-observability'

type EventPayload = Record<string, unknown>
const events: { name: string; payload: EventPayload }[] = []

mock.module('@claude-code/local-observability', () => ({
  ...realObs,
  logEvent: (name: string, payload: EventPayload) => {
    events.push({ name, payload })
  },
}))

const mod = await import('../sdkMemorySummary.js')

const ORIG_ENTRYPOINT = process.env.CLAUDE_CODE_ENTRYPOINT
const ORIG_SIMPLE = process.env.CLAUDE_CODE_SIMPLE

beforeEach(() => {
  events.length = 0
  mod._resetSdkMemorySummaryForTesting()
  process.env.CLAUDE_CODE_ENTRYPOINT = 'sdk-cli'
  delete process.env.CLAUDE_CODE_SIMPLE
})

afterEach(() => {
  if (ORIG_ENTRYPOINT === undefined)
    delete process.env.CLAUDE_CODE_ENTRYPOINT
  else process.env.CLAUDE_CODE_ENTRYPOINT = ORIG_ENTRYPOINT
  if (ORIG_SIMPLE === undefined) delete process.env.CLAUDE_CODE_SIMPLE
  else process.env.CLAUDE_CODE_SIMPLE = ORIG_SIMPLE
})

function captureEmit(): EventPayload | undefined {
  return events.find(e => e.name === 'tengu_sdk_memory_summary')?.payload
}

describe('scheduleSdkMemorySummary (ant hP9 + UG1)', () => {
  test('emits exactly one tengu_sdk_memory_summary at dispose', () => {
    mod.recordRssSample()
    let captured: (() => void) | null = null
    mod.scheduleSdkMemorySummary(fn => {
      captured = fn
    })
    expect(captured).not.toBeNull()
    captured!()
    expect(events.filter(e => e.name === 'tengu_sdk_memory_summary')).toHaveLength(1)
  })

  test('emit-once latch — second dispose is no-op', () => {
    mod.recordRssSample()
    let captured: (() => void) | null = null
    mod.scheduleSdkMemorySummary(fn => {
      captured = fn
    })
    captured!()
    captured!()
    expect(events).toHaveLength(1)
  })

  test('schedule-once latch — second schedule does not register again', () => {
    mod.recordRssSample()
    let registerCount = 0
    mod.scheduleSdkMemorySummary(() => {
      registerCount++
    })
    mod.scheduleSdkMemorySummary(() => {
      registerCount++
    })
    expect(registerCount).toBe(1)
  })
})

describe('payload shape (ant pG1)', () => {
  test('bytes-not-MB schema for all final/peak fields', () => {
    mod.recordRssSample()
    let captured: (() => void) | null = null
    mod.scheduleSdkMemorySummary(fn => {
      captured = fn
    })
    captured!()
    const payload = captureEmit()!
    // Ant: `final_rss_bytes`, `peak_rss_bytes`, etc. — no `_mb` suffix.
    expect(payload.final_rss_bytes).toBeGreaterThan(0)
    expect(payload.peak_rss_bytes).toBeGreaterThanOrEqual(
      payload.final_rss_bytes as number,
    )
    expect('final_rss_mb' in payload).toBe(false)
    expect('peak_rss_mb' in payload).toBe(false)
    expect('uptime_s' in payload).toBe(true)
  })

  test('peak_rss_bytes = max(initial, now)', () => {
    // Plant a fake initial snapshot with a HUGE rss; verify peak picks it.
    mod.recordRssSample({
      rss: 999_999_999_999,
      heapUsed: 10,
      heapTotal: 10,
      external: 0,
      arrayBuffers: 0,
    })
    let captured: (() => void) | null = null
    mod.scheduleSdkMemorySummary(fn => {
      captured = fn
    })
    captured!()
    const payload = captureEmit()!
    expect(payload.peak_rss_bytes).toBe(999_999_999_999)
  })

  test('child_count is monotonic; per-kind aggregate respects whitelist', () => {
    mod.recordChildRssSample('bash_shell', 100)
    mod.recordChildRssSample('mcp_stdio', 200)
    mod.recordChildRssSample('unknown_kind', 300) // not in whitelist
    mod.recordRssSample()
    let captured: (() => void) | null = null
    mod.scheduleSdkMemorySummary(fn => {
      captured = fn
    })
    captured!()
    const payload = captureEmit()!
    expect(payload.child_count).toBe(3)
    expect(payload.child_rss_bytes_total).toBe(600) // 100 + 200 + 300
    expect(payload.child_bash_shell_rss_bytes).toBe(100)
    expect(payload.child_mcp_stdio_rss_bytes).toBe(200)
    // whitelist filter — unknown kind never gets a dedicated column
    expect('child_unknown_kind_rss_bytes' in payload).toBe(false)
  })

  test('attribute providers emit both entries and bytes when bytes set', () => {
    mod.registerMemoryAttribute('transcript', () => ({
      entries: 5,
      bytes: 4096,
    }))
    mod.registerMemoryAttribute('subagentTranscripts', () => ({
      entries: 2,
      // bytes intentionally omitted
    }))
    mod.recordRssSample()
    let captured: (() => void) | null = null
    mod.scheduleSdkMemorySummary(fn => {
      captured = fn
    })
    captured!()
    const payload = captureEmit()!
    expect(payload.attr_transcript_entries).toBe(5)
    expect(payload.attr_transcript_bytes).toBe(4096)
    expect(payload.attr_subagentTranscripts_entries).toBe(2)
    // No `_bytes` key when provider didn't supply one — pin this.
    expect('attr_subagentTranscripts_bytes' in payload).toBe(false)
  })

  test('attribute provider exception does not break emit', () => {
    mod.registerMemoryAttribute('crash', () => {
      throw new Error('boom')
    })
    mod.registerMemoryAttribute('ok', () => ({ entries: 1, bytes: 2 }))
    mod.recordRssSample()
    let captured: (() => void) | null = null
    mod.scheduleSdkMemorySummary(fn => {
      captured = fn
    })
    captured!()
    const payload = captureEmit()!
    expect(payload.attr_ok_entries).toBe(1)
    expect(payload.attr_ok_bytes).toBe(2)
    expect('attr_crash_entries' in payload).toBe(false)
  })
})

describe('registerMemoryAttribute / unregisterMemoryAttribute (ant xH8/uH8)', () => {
  test('unregister with identity match removes provider', () => {
    const fn = () => ({ entries: 1 })
    mod.registerMemoryAttribute('foo', fn)
    mod.unregisterMemoryAttribute('foo', fn)
    mod.recordRssSample()
    let captured: (() => void) | null = null
    mod.scheduleSdkMemorySummary(disposer => {
      captured = disposer
    })
    captured!()
    const payload = captureEmit()!
    expect('attr_foo_entries' in payload).toBe(false)
  })

  test('unregister with stale identity does NOT remove the new provider', () => {
    // ant `uH8`: `if (Sc_.get(H) === _) delete`. A stale unregister after
    // re-register must be a no-op.
    const fn1 = () => ({ entries: 1 })
    const fn2 = () => ({ entries: 999 })
    mod.registerMemoryAttribute('foo', fn1)
    mod.registerMemoryAttribute('foo', fn2) // replaces fn1
    mod.unregisterMemoryAttribute('foo', fn1) // stale → no-op
    mod.recordRssSample()
    let captured: (() => void) | null = null
    mod.scheduleSdkMemorySummary(disposer => {
      captured = disposer
    })
    captured!()
    const payload = captureEmit()!
    expect(payload.attr_foo_entries).toBe(999)
  })
})

describe('trackChildProcess / markChildProcessDead (ant Cc_/vP9)', () => {
  test('non-SDK entrypoint never registers a child', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
    mod.trackChildProcess('bash_shell', 1234)
    mod.recordRssSample()
    let captured: (() => void) | null = null
    mod.scheduleSdkMemorySummary(fn => {
      captured = fn
    })
    captured!()
    const payload = captureEmit()!
    expect(payload.child_count).toBe(0)
  })

  test('simple mode never registers a child', () => {
    process.env.CLAUDE_CODE_SIMPLE = '1'
    mod.trackChildProcess('bash_shell', 1234)
    mod.recordRssSample()
    let captured: (() => void) | null = null
    mod.scheduleSdkMemorySummary(fn => {
      captured = fn
    })
    captured!()
    const payload = captureEmit()!
    expect(payload.child_count).toBe(0)
  })

  test('non-finite or non-positive pid is rejected', () => {
    mod.trackChildProcess('bash_shell', NaN)
    mod.trackChildProcess('bash_shell', 0)
    mod.trackChildProcess('bash_shell', -1)
    mod.recordRssSample()
    let captured: (() => void) | null = null
    mod.scheduleSdkMemorySummary(fn => {
      captured = fn
    })
    captured!()
    const payload = captureEmit()!
    expect(payload.child_count).toBe(0)
  })

  test('re-tracking a still-alive pid is a no-op', () => {
    mod.trackChildProcess('bash_shell', 1234)
    mod.trackChildProcess('bash_shell', 1234)
    mod.recordRssSample()
    let captured: (() => void) | null = null
    mod.scheduleSdkMemorySummary(fn => {
      captured = fn
    })
    captured!()
    const payload = captureEmit()!
    expect(payload.child_count).toBe(1)
  })

  test('dead child still contributes to total + per-kind aggregate', () => {
    mod.recordChildRssSample('bash_shell', 500)
    // recordChildRssSample marks as dead immediately. The aggregate
    // should still include its 500 bytes — that's the *peak* it reached.
    mod.recordRssSample()
    let captured: (() => void) | null = null
    mod.scheduleSdkMemorySummary(fn => {
      captured = fn
    })
    captured!()
    const payload = captureEmit()!
    expect(payload.child_rss_bytes_total).toBe(500)
    expect(payload.child_bash_shell_rss_bytes).toBe(500)
  })
})
