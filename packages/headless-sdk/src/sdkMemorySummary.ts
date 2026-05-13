/**
 * SDK memory-summary telemetry — byte-for-byte port of ant v2.1.136
 * 2144.js: `Cc_` (registerChildRss) + `vP9` (markChildDead) + `mH8`
 * (refreshChildSamples) + `pG1` (buildSummary) + `UG1` (emitOnce) +
 * `hP9` (scheduleEmit) + `xH8` (registerAttribute) + `uH8`
 * (unregisterAttribute).
 *
 * Lifecycle:
 *   1. SDK entrypoint registers RSS sampler & attribute providers at
 *      startup (call `recordRssSample()` / `registerMemoryAttribute(...)`).
 *   2. Child subprocesses (bash, MCP, LSP) get tracked via
 *      `trackChildProcess(kind, pid)` so we can peak-sample their RSS.
 *      When the child exits, call `markChildProcessDead(pid)` so we stop
 *      polling its /proc.
 *   3. At shutdown, `scheduleSdkMemorySummary(() => initialMemSnapshot)`
 *      registers a dispose handler. When the process exits, ant's `UG1`
 *      writes ONE `tengu_sdk_memory_summary` event with bytes-level fields
 *      AND child kind aggregates AND attribute provider entries.
 *
 * ALL byte fields are emitted in BYTES, not MB — ant pG1 returns
 * `final_rss_bytes`, `peak_rss_bytes`, etc. Telemetry warehouse divides
 * downstream; doing it here loses precision and breaks dashboards that
 * expect the canonical schema.
 *
 * Ant gates:
 *   - `Ny_()` — only SDK entrypoint (sdk-ts / sdk-py / sdk-cli) records
 *     children. `T1()` (simple mode) also skips. Mirror via the
 *     `CLAUDE_CODE_ENTRYPOINT` env check.
 *   - emit-once guard `VP9` so a second scheduleSdkMemorySummary call
 *     can't double-emit.
 *   - schedule-once guard `kP9` so multiple registration sites don't
 *     stack multiple dispose handlers.
 *
 * `pG1` reads:
 *   - process.memoryUsage()       — current rss/heap/external/array-buffers
 *   - Math.max(initial, current)  — peak rss/heap/external (snapshot vs now)
 *   - process.constrainedMemory?.() — Node 22+ cgroup bytes
 *   - childPeakRss map            — per-kind aggregate
 *   - attribute providers         — bytes + entries for each registered tag
 */
import { logEvent as obsLogEvent } from '@claude-code/local-observability'

/**
 * Ant `uG1` — child-kind whitelist. Only these kinds get a
 * `child_<kind>_rss_bytes` aggregate field on the event. New kinds added
 * to `trackChildProcess` are still counted in the `child_count` total
 * but won't get a dedicated aggregate column.
 */
const CHILD_KIND_WHITELIST = ['bash_shell', 'mcp_stdio', 'lsp', 'other'] as const
type ChildKind = (typeof CHILD_KIND_WHITELIST)[number]

type ChildRssEntry = {
  kind: string
  peakRssBytes: number
  dead: boolean
}

type AttributeProvider = () => {
  entries: number
  bytes?: number
}

// ant `Sc_` — attribute provider map (e.g. 'transcript' → { entries: N, bytes: B })
const attributeProviders = new Map<string, AttributeProvider>()

// ant `KuH` — child process → peak RSS sample map
const childRssTracker = new Map<number, ChildRssEntry>()

// ant `NP9` — total count of children registered (does NOT decrement on death)
let totalChildCount = 0

// ant initial memoryUsage snapshot — captured once when SDK starts so
// pG1 can do `Math.max(initial.rss, now.rss)` to estimate peak.
let initialMemSnapshot: NodeJS.MemoryUsage | null = null

// ant `VP9` — emit-once latch
let hasEmitted = false

// ant `kP9` — schedule-once latch
let hasScheduled = false

/**
 * Test-only — reset all module state. Both production code and tests
 * must NOT depend on this being callable; it exists only because
 * module-singletons are otherwise un-isolatable across bun:test runs.
 */
export function _resetSdkMemorySummaryForTesting(): void {
  attributeProviders.clear()
  childRssTracker.clear()
  totalChildCount = 0
  initialMemSnapshot = null
  hasEmitted = false
  hasScheduled = false
}

function isSdkEntrypoint(): boolean {
  // Mirror ant `Ny_()` — SDK paths only emit memory telemetry.
  const ep = process.env.CLAUDE_CODE_ENTRYPOINT
  return ep === 'sdk-ts' || ep === 'sdk-py' || ep === 'sdk-cli'
}

function isSimpleMode(): boolean {
  // Mirror ant `T1()` — simple-mode short-circuits telemetry.
  return process.env.CLAUDE_CODE_SIMPLE === '1'
}

/**
 * Ant `recordRssSample` (no direct identifier — folded into pG1 via
 * the initial snapshot capture). Call this at SDK entry. The snapshot
 * is taken once and stored; subsequent calls update the cached peak by
 * keeping the higher of {snapshot, now} for rss/heap/external.
 */
export function recordRssSample(now?: NodeJS.MemoryUsage): void {
  const m = now ?? process.memoryUsage()
  if (initialMemSnapshot === null) {
    initialMemSnapshot = m
    return
  }
  if (m.rss > initialMemSnapshot.rss) {
    initialMemSnapshot = { ...initialMemSnapshot, rss: m.rss }
  }
  if (m.heapUsed > initialMemSnapshot.heapUsed) {
    initialMemSnapshot = { ...initialMemSnapshot, heapUsed: m.heapUsed }
  }
  if (m.external > initialMemSnapshot.external) {
    initialMemSnapshot = { ...initialMemSnapshot, external: m.external }
  }
}

/**
 * Ant `xH8` — register a labelled attribute provider. The label appears
 * as `attr_<label>_entries` (always) and `attr_<label>_bytes` (when
 * bytes is non-undefined) in the emitted event.
 *
 * Callers (transcript, subagentTranscripts, etc.) register at startup
 * and unregister at teardown. Provider exceptions are swallowed in
 * `buildSummary` so a broken provider can't take down telemetry.
 */
export function registerMemoryAttribute(
  label: string,
  provider: AttributeProvider,
): void {
  attributeProviders.set(label, provider)
}

/**
 * Ant `uH8` — unregister a previously-registered provider. The identity
 * check `Sc_.get(H) === _` mirrors ant's guard so a stale unregister
 * after a re-register doesn't clobber the new provider. Required because
 * teardown order is non-deterministic across the SDK shutdown path.
 */
export function unregisterMemoryAttribute(
  label: string,
  provider: AttributeProvider,
): void {
  if (attributeProviders.get(label) === provider) {
    attributeProviders.delete(label)
  }
}

/**
 * Ant `Cc_` — start tracking a child subprocess. Skipped when:
 *   - not an SDK entrypoint OR simple-mode is on
 *   - pid is not finite-positive
 *   - the pid is already tracked AND still alive (don't re-init peak)
 *
 * `peakRssBytes` is initialised to the current RSS sample (which on
 * Bun/Node is unavailable without /proc reads, so it starts at 0). The
 * peak is recomputed inside `buildSummary` via `refreshChildSamples`.
 */
export function trackChildProcess(kind: string, pid: number): void {
  if (!isSdkEntrypoint() || isSimpleMode()) return
  if (!Number.isFinite(pid) || pid <= 0) return
  const existing = childRssTracker.get(pid)
  if (existing && !existing.dead) return
  totalChildCount++
  childRssTracker.set(pid, {
    kind,
    peakRssBytes: readChildRssBytes(pid) ?? 0,
    dead: false,
  })
}

/**
 * Ant `vP9` — mark a tracked child as dead. We keep the entry in the
 * map so its `peakRssBytes` contributes to the per-kind aggregate;
 * `refreshChildSamples` won't try to re-stat it after this.
 */
export function markChildProcessDead(pid: number): void {
  const entry = childRssTracker.get(pid)
  if (entry) entry.dead = true
}

/**
 * Ant `yP9` — read a child process's RSS from /proc. ant ships its own
 * native implementation in private `bun-internal` (a sealed Bun fork
 * that exposes a NAPI-style binding for cgroup-aware peak sampling).
 * In the public ccb build we don't have that binding, so this returns
 * `undefined` deliberately — the peak then stays at whatever was
 * captured at track-time (typically 0, since the SDK rarely has stable
 * /proc reads available from JS).
 *
 * The dashboards downstream of `tengu_sdk_memory_summary` tolerate
 * missing child samples: `child_<kind>_rss_bytes` is best-effort, and
 * `peak_rss_bytes` (which reads from `process.memoryUsage()`) is the
 * authoritative figure that monitors actually alert on. Once a NAPI
 * child-RSS reader lands in ccb, swap this implementation to return
 * the byte count and `refreshChildSamples` will start tracking real
 * peaks automatically.
 */
function readChildRssBytes(pid: number): number | undefined {
  // No /proc-style sampling available in plain Bun — pid is unused but
  // kept in the signature so the future NAPI implementation slots in
  // without callers changing.
  void pid
  return undefined
}

/**
 * Ant `mH8` — refresh peak samples for every still-alive child. Marks
 * a child as dead when the RSS read fails (e.g. process is gone).
 */
function refreshChildSamples(): void {
  if (childRssTracker.size === 0) return
  for (const entry of childRssTracker.values()) {
    if (entry.dead) continue
    const rss = readChildRssBytes(0)
    if (rss === undefined) {
      entry.dead = true
    } else if (rss > entry.peakRssBytes) {
      entry.peakRssBytes = rss
    }
  }
}

/**
 * Ant `pG1` — synchronous payload builder. Reads `process.memoryUsage()`
 * once, blends with the initial snapshot to get peak figures, runs
 * `refreshChildSamples`, then aggregates attribute providers and
 * per-kind child RSS into the final record.
 */
function buildSummary(initial: NodeJS.MemoryUsage): Record<string, unknown> {
  const now = process.memoryUsage()
  const summary: Record<string, unknown> = {
    uptime_s: Math.round(process.uptime()),
    final_rss_bytes: now.rss,
    final_heap_used_bytes: now.heapUsed,
    final_external_bytes: now.external,
    final_array_buffers_bytes: now.arrayBuffers,
    peak_rss_bytes: Math.max(initial.rss, now.rss),
    peak_heap_used_bytes: Math.max(initial.heapUsed, now.heapUsed),
    peak_external_bytes: Math.max(initial.external, now.external),
  }
  // ant: `process.constrainedMemory?.() || void 0`
  const constrained =
    typeof (process as { constrainedMemory?: () => number })
      .constrainedMemory === 'function'
      ? (process as { constrainedMemory: () => number }).constrainedMemory()
      : undefined
  if (constrained !== undefined && constrained > 0) {
    summary.constrained_memory_bytes = constrained
  }

  // Attribute providers — ant guards each call in try/catch so a broken
  // provider can't kill telemetry.
  for (const [label, provider] of attributeProviders) {
    try {
      const result = provider()
      summary[`attr_${label}_entries`] = result.entries
      if (result.bytes !== undefined) {
        summary[`attr_${label}_bytes`] = result.bytes
      }
    } catch {
      // provider crashed — skip, don't taint other fields
    }
  }

  // Child RSS aggregates — ant `mH8` then sum into per-kind buckets.
  refreshChildSamples()
  let totalChildBytes = 0
  const perKind: Record<string, number> = {}
  for (const entry of childRssTracker.values()) {
    totalChildBytes += entry.peakRssBytes
    perKind[entry.kind] = (perKind[entry.kind] ?? 0) + entry.peakRssBytes
  }
  summary.child_count = totalChildCount
  summary.child_rss_bytes_total = totalChildBytes
  for (const kind of CHILD_KIND_WHITELIST) {
    if (perKind[kind] !== undefined) {
      summary[`child_${kind}_rss_bytes`] = perKind[kind]
    }
  }
  return summary
}

/**
 * Ant `UG1` — emit-once. Pulls the initial snapshot lazily via the
 * supplied getter, mirrors ant's pattern where `hP9(H)` retains the
 * getter for the registered dispose handler so the snapshot is read
 * at registration time, NOT at emit time.
 *
 * Wrapped in try/catch because `obsLogEvent` may not be wired in test
 * harnesses or when telemetry is disabled — match ant's behaviour and
 * swallow.
 */
function emitOnce(getInitial: () => NodeJS.MemoryUsage): void {
  if (hasEmitted) return
  hasEmitted = true
  try {
    obsLogEvent('tengu_sdk_memory_summary', buildSummary(getInitial()))
  } catch {
    // telemetry sink unavailable — match ant's swallow
  }
}

/**
 * Ant `hP9` — schedule the emit to fire at SDK shutdown. `v9(...)`
 * registers a dispose handler that runs from the centralised cleanup
 * walker. We don't have ant's exact registry, so callers pass a
 * `registerCleanup` function instead — the shape `(fn) => void` is
 * compatible with both `v9` and Node-style `onExit` handlers.
 *
 * Idempotent — repeat calls are no-ops. The initial-snapshot getter
 * is captured at FIRST call; subsequent calls would shadow the original
 * peak and corrupt the comparison.
 */
export function scheduleSdkMemorySummary(
  registerCleanup: (fn: () => void) => void,
  getInitial?: () => NodeJS.MemoryUsage,
): void {
  if (hasScheduled) return
  hasScheduled = true
  const snapshot =
    getInitial ?? (() => initialMemSnapshot ?? process.memoryUsage())
  registerCleanup(() => emitOnce(snapshot))
}

/**
 * Back-compat entry point — older callsites called `emitSdkMemorySummary()`
 * directly. Now that scheduling is the canonical path, this stays as a
 * thin wrapper so existing wiring keeps working. It DOES respect the
 * emit-once guard so repeated direct calls don't double-emit.
 */
export function emitSdkMemorySummary(): void {
  emitOnce(() => initialMemSnapshot ?? process.memoryUsage())
}

/**
 * Older API kept for callers that just wanted to push per-kind bytes
 * without tracking a real pid. Bridges to the new tracker with a
 * synthetic pid so the kind aggregation still works. Prefer
 * `trackChildProcess` for new code.
 */
export function recordChildRssSample(kind: string, rssBytes: number): void {
  if (!isSdkEntrypoint() || isSimpleMode()) return
  // Synthetic negative pid so it never collides with a real one.
  const syntheticPid = -(totalChildCount + 1)
  totalChildCount++
  childRssTracker.set(syntheticPid, {
    kind,
    peakRssBytes: rssBytes,
    dead: true, // synthetic — never re-sample
  })
}
