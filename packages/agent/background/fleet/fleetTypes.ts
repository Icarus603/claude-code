/**
 * Canonical types for the Agent View ("FleetView") feature.
 *
 * Mirrors ant v2.1.143 5092.js + 2507.js shapes 1:1. State machine:
 *
 *   state:   "working" → "blocked" → "done" | "failed" | "stopped"
 *   tempo:   "active"  | "blocked"  | "idle"
 *
 *   working+active  → spinner, undimmed
 *   working+blocked → "Needs input" bucket, warning color, waiting glyph
 *   done|failed|stopped (+ tempo=idle) → "Completed" bucket
 *
 * Source mapping:
 *   - FleetJob, FleetJobState  → ant H7H() return + _7H() factory (2507.js:306-377)
 *   - FleetBand                → ant uyH (5092.js:172-177)
 *   - FleetActivity            → ant GZ6 (5092.js:154-171)
 *   - FleetBucket              → ant PZ6 (5092.js:181-199), labels zdK (5093.js:107-112)
 *   - FleetChildSummary        → ant `state.children` (`{kind: "agent"|"frame", href, id?}`)
 *   - FleetPrSummary           → daemon PR status rollup, shape from M$6 readers
 */

import type { AgentColorName } from '@claude-code/tool-registry/tools/AgentTool/agentColorManager.js'

/**
 * Per-row outcome rollup. Drives row glyph + label color in the Working /
 * Completed bands. Source: ant GZ6 (5092.js:154-171).
 */
export type FleetActivity =
  | 'success'
  | 'failure'
  | 'stopped'
  | 'flowing'
  | 'slowing'
  | 'stuck'

/**
 * Lifecycle band a row belongs to. Source: ant uyH (5092.js:172-177).
 * "active" = working+spinning, "blocked" = needs human, "completed" = done/failed/stopped.
 */
export type FleetBand = 'active' | 'blocked' | 'completed'

/**
 * Section bucket displayed in the TUI. Source: ant $dK (5093.js:106).
 * Priority order: review > blocked > working > done.
 */
export type FleetBucket = 'review' | 'blocked' | 'working' | 'done'

/**
 * Worker-process presence label, derived from daemon `list` op.
 * Source: ant `q` arg of PZ6/Ti8/pdK — the worker presence enum.
 */
export type FleetPresence = 'busy' | 'shell' | 'waiting' | undefined

/**
 * Per-row session lifecycle status persisted in `state.json`.
 * Source: ant state.state ("working" | "blocked" | "done" | "failed" | "stopped").
 */
export type FleetJobStatus = 'working' | 'blocked' | 'done' | 'failed' | 'stopped'

/**
 * Per-row tempo — drives auto-respawn and spinner decision.
 * Source: ant state.tempo.
 */
export type FleetTempo = 'active' | 'blocked' | 'idle'

/**
 * Source field of `state.nameSource` — whether the display label was
 * auto-generated from intent or set manually by the user.
 */
export type FleetNameSource = 'auto' | 'user'

/**
 * Inline child reference summary used for PR rollup + frame rollup.
 * Source: ant state.children entries.
 */
export interface FleetChildSummary {
  /** "agent" for spawned subagent, "frame" for an antspace frame ref. */
  kind: 'agent' | 'frame'
  /** Subagent session id or frame ref. */
  id?: string
  /** Reference URL (PR URL or frame URL). */
  href: string
}

/**
 * Block payload when a worker is paused waiting for the user.
 * Source: ant state.block — schema at 2508.js:
 *   block: y.object({
 *     questions: y.array(y.object({
 *       question: y.string(),
 *       options: y.array(y.object({
 *         label: y.string(),
 *         description: y.string()
 *       }))
 *     }))
 *   }).optional()
 *
 * Each question carries an optional list of pre-canned answer options
 * (e.g. yes/no/skip). ant's peek panel renders questions[0] as a bold
 * header + numbered options list (KdK 5091.js) and ant's gs3 onKeyDown
 * lets the user press 1-9 to pick options[N-1].label (OdK 5091.js).
 */
export interface FleetBlockQuestionOption {
  /** Source: ant option.label — what the option submits as a reply. */
  label: string
  /** Source: ant option.description — optional dim subtitle. */
  description: string
}

export interface FleetBlockQuestion {
  /** Source: ant question.question — the bold header text. */
  question: string
  /** Source: ant question.options. */
  options: FleetBlockQuestionOption[]
}

export interface FleetBlockPayload {
  questions?: FleetBlockQuestion[]
}

/**
 * In-flight marker — what the worker is currently doing (set when a
 * cron tick or auto-routine is mid-run, cleared on idle).
 * Source: ant state.inFlight.
 */
export interface FleetInFlightMarker {
  kinds: Array<'session_cron' | 'auto_routine' | string>
}

/**
 * Serialised per-job state living in `state.json` on disk. The daemon
 * `list` op returns this verbatim for each session it tracks.
 *
 * Source: ant _7H factory (2507.js:348-378) + later mutations during
 * worker lifecycle.
 */
export interface FleetJobState {
  state: FleetJobStatus
  tempo: FleetTempo
  detail: string
  needs?: string
  output: Record<string, string> | null
  children: FleetChildSummary[] | null
  linkScanOffset: number
  template: string
  routine?: string
  respawnFlags: string[]
  intent: string
  name?: string
  nameSource?: FleetNameSource
  initialPrompt?: string
  sessionId: string
  resumeSessionId?: string
  daemonShort: string
  cwd: string
  createdAt: string
  updatedAt: string
  firstTerminalAt: string | null
  worktreePath?: string
  worktreeBranch?: string
  worktreeHookBased?: boolean
  originCwd?: string
  backend: 'daemon'
  /** Set true when pin set contains this job's id. From ant H7H pin-merge. */
  pinned?: boolean
  /** Optional structured block payload when tempo === 'blocked'. */
  block?: FleetBlockPayload
  /** Pre-rolled reply suggestion shown next to the row when waiting. */
  suggestedReply?: string
  /** What's currently running (cron, routine). */
  inFlight?: FleetInFlightMarker
  /** Subagent color override (1:1 with ant AGENT_COLORS / yz). */
  color?: AgentColorName
  /** Manual reorder marker — overrides createdAt-based sort when set. */
  sortOrder?: number
  /** Manual reorder marker for cross-bucket order. */
  stateSortOrder?: number
}

/**
 * Top-level fleet job entry as returned from `listFleetJobs()`.
 * Source: ant H7H return — `{id, state}[]`.
 */
export interface FleetJob {
  /** Daemon short id (8 chars of session id). */
  id: string
  state: FleetJobState
}

/**
 * Daemon worker presence row, parallel to FleetJob but for sessions
 * tracked by the daemon roster that have not yet been persisted to
 * disk. Source: ant Fp9 adoption helper (2507.js:379-407).
 */
export interface FleetDaemonWorker {
  /** 8-char short id. */
  short: string
  /** Agent template name. Optional — defaults to "bg". */
  agent?: string
  routine?: string
  intent: string
  name?: string
  detail: string
  sessionId: string
  cwd: string
  worktreePath?: string
  /** Lifecycle source (spare-pool workers shouldn't surface in UI). */
  source?: 'spare' | 'roster' | string
  /** True if worker is shutting down — don't surface in UI. */
  dying?: boolean
}

/**
 * PR status rollup, fed by the daemon's PR cache, looked up by URL.
 * Source: ant 5092.js readers of `_?.get(href)`.
 */
export interface FleetPrSummary {
  /** Source: ant Il5 — PR number for display label `#<number> <title>`. */
  number?: number
  /** Source: ant Il5 — PR title for display label. */
  title?: string
  /**
   * Source: ant Il5 — PR state. ant has "DRAFT" as a distinct state when
   * H.isDraft (Il5: `state: H.isDraft ? "DRAFT" : "OPEN"`). M$6 handles
   * DRAFT → "inactive".
   */
  state: 'OPEN' | 'DRAFT' | 'MERGED' | 'CLOSED'
  review:
    | 'APPROVED'
    | 'CHANGES_REQUESTED'
    | 'REVIEW_REQUIRED'
    | 'COMMENTED'
    | null
  checks: { failed: number; pending: number; passed: number }
  /** Source: ant Il5 — added LOC for peek diffStat. */
  additions?: number
  /** Source: ant Il5 — removed LOC for peek diffStat. */
  deletions?: number
}

/** PR cache passed through hooks. Source: ant 5092.js prCache arg. */
export type FleetPrCache = Map<string, FleetPrSummary>

/**
 * Frame (antspace) status rollup keyed by frame ref id.
 * Source: ant 5092.js frame cache reader.
 */
export interface FleetFrameSummary {
  state: 'attached' | 'detached' | 'gone'
}

/** Rolled-up status segment displayed in PR rollup column. */
export interface FleetStatusSegment {
  text: string
  color?: 'success' | 'error' | 'warning' | 'merged' | 'inactive'
  sortRank?: number
}
