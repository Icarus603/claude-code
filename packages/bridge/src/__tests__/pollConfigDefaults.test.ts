import { describe, expect, test } from 'bun:test'
import { DEFAULT_POLL_CONFIG } from '../pollConfigDefaults.js'

describe('DEFAULT_POLL_CONFIG — anchor against operational constraints', () => {
  // The values in this snapshot are bound to documented server-side TTLs
  // and operational headroom decisions. If any value changes, the
  // operations team must verify against:
  //
  //   - BRIDGE_LAST_POLL_TTL (4h Redis key expiry)
  //   - max_poll_stale_seconds (24h health gate)
  //   - work_service.py:24 (reclaim threshold)
  //   - server's 300s heartbeat TTL
  //
  // Keeping these constants snapshotted catches accidental "tune this
  // little knob to test" PRs that ship without ops review.

  test('not-at-capacity poll = 2 seconds', () => {
    // Active-pickup latency. Lower → snappier "connecting…" UX, higher
    // server pressure. 2s is a documented balance point.
    expect(DEFAULT_POLL_CONFIG.poll_interval_ms_not_at_capacity).toBe(2000)
  })

  test('at-capacity poll = 10 minutes (600,000 ms)', () => {
    // Has 24× headroom on the 4h Redis TTL. Documented as "strictly a
    // liveness signal plus backstop for permanent close" — the WS
    // transport handles transient reconnects internally.
    expect(DEFAULT_POLL_CONFIG.poll_interval_ms_at_capacity).toBe(600_000)
  })

  test('non_exclusive_heartbeat_interval_ms = 0 (disabled by default)', () => {
    // 0 = disabled. Documents the opt-in default. Ops can tune via
    // tengu_bridge_poll_interval_config without code changes.
    expect(DEFAULT_POLL_CONFIG.non_exclusive_heartbeat_interval_ms).toBe(0)
  })

  test('reclaim_older_than_ms = 5000 (matches server constant)', () => {
    // CRITICAL: must match server's work_service.py DEFAULT_RECLAIM_OLDER_THAN_MS.
    // Drift here → reclaimed work flips between client/server versions of
    // "stale" → silent silent failure (work item picked up by neither).
    expect(DEFAULT_POLL_CONFIG.reclaim_older_than_ms).toBe(5000)
  })

  test('session_keepalive_interval_v2_ms = 2 minutes', () => {
    // 120,000 ms = 2 min keepalive frame interval. Must be < upstream
    // proxy idle GC threshold (typically 5 min). 2.5× safety factor.
    expect(DEFAULT_POLL_CONFIG.session_keepalive_interval_v2_ms).toBe(120_000)
  })
})

describe('DEFAULT_POLL_CONFIG — multisession defaults match single-session', () => {
  // The split between single-session (replBridge) and multisession
  // (bridgeMain) lets ops tune separately. The defaults must match so
  // existing GrowthBook configs without the multisession fields keep
  // working. If a future PR drifts the defaults apart, multisession
  // bridges would behave differently from single-session ones.

  test('multisession not-at-capacity == single-session not-at-capacity', () => {
    expect(
      DEFAULT_POLL_CONFIG.multisession_poll_interval_ms_not_at_capacity,
    ).toBe(DEFAULT_POLL_CONFIG.poll_interval_ms_not_at_capacity)
  })

  test('multisession partial-capacity == not-at-capacity (no separate tier yet)', () => {
    // Documents that partial-capacity defaults to not-at-capacity. If a
    // future tier is added (e.g. "10s when half-full"), this test forces
    // a conscious decision about the ratio.
    expect(
      DEFAULT_POLL_CONFIG.multisession_poll_interval_ms_partial_capacity,
    ).toBe(DEFAULT_POLL_CONFIG.poll_interval_ms_not_at_capacity)
  })

  test('multisession at-capacity == single-session at-capacity', () => {
    expect(
      DEFAULT_POLL_CONFIG.multisession_poll_interval_ms_at_capacity,
    ).toBe(DEFAULT_POLL_CONFIG.poll_interval_ms_at_capacity)
  })
})

describe('DEFAULT_POLL_CONFIG — relative ordering invariants', () => {
  test('at-capacity poll is much SLOWER than not-at-capacity', () => {
    // The not-at-capacity loop is the active-pickup hot path; the
    // at-capacity loop is liveness-only. Relative ordering is the design.
    expect(DEFAULT_POLL_CONFIG.poll_interval_ms_at_capacity).toBeGreaterThan(
      DEFAULT_POLL_CONFIG.poll_interval_ms_not_at_capacity,
    )
  })

  test('keepalive interval << at-capacity poll interval', () => {
    // Keepalive must fire more often than poll, otherwise upstream
    // proxies would close idle WS sessions before the next poll.
    expect(DEFAULT_POLL_CONFIG.session_keepalive_interval_v2_ms).toBeLessThan(
      DEFAULT_POLL_CONFIG.poll_interval_ms_at_capacity,
    )
  })

  test('reclaim threshold is sub-second-scale (< 30s)', () => {
    // Server matches at 5s; a future drift to 30s+ would mean the client
    // could be holding "fresh" work that the server has already
    // re-dispatched — duplicate execution.
    expect(DEFAULT_POLL_CONFIG.reclaim_older_than_ms).toBeLessThan(30_000)
  })
})

describe('PollIntervalConfig — type contract', () => {
  test('all 8 documented fields are present', () => {
    // The type alias enumerates the 8 tunable knobs. If a refactor adds
    // a 9th knob, this test forces the addition to be intentional.
    const keys = Object.keys(DEFAULT_POLL_CONFIG).sort()
    expect(keys).toEqual([
      'multisession_poll_interval_ms_at_capacity',
      'multisession_poll_interval_ms_not_at_capacity',
      'multisession_poll_interval_ms_partial_capacity',
      'non_exclusive_heartbeat_interval_ms',
      'poll_interval_ms_at_capacity',
      'poll_interval_ms_not_at_capacity',
      'reclaim_older_than_ms',
      'session_keepalive_interval_v2_ms',
    ])
  })

  test('all values are non-negative integers (ms count)', () => {
    for (const value of Object.values(DEFAULT_POLL_CONFIG)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(value)).toBe(true)
    }
  })
})
