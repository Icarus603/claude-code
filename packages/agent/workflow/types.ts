// Shared types for the workflow engine. Port of the progress-event and
// hook-option shapes from ant 2.1.150 (3886 Gb8 / 3858 dt7 / 3904 ub8).

import type { WorkflowPhaseMeta } from './metaParser.js'

// ───────────────────────── progress events ─────────────────────────
// Emitted by the hook factory as the script runs; batched into the task's
// `workflowProgress` array (LocalWorkflowTaskState) and rendered by the
// /workflows UI. Three kinds: per-agent state, per-phase grouping, narrator
// log lines.

export type WorkflowAgentState = 'start' | 'progress' | 'done' | 'error'

export type WorkflowAgentProgress = {
  type: 'workflow_agent'
  index: number
  label: string
  phaseIndex?: number
  phaseTitle?: string
  agentId: string
  agentType?: string
  isolation?: 'worktree'
  model?: string
  state: WorkflowAgentState
  startedAt: number
  lastProgressAt: number
  tokens?: number
  toolCalls?: number
  durationMs?: number
  error?: string
}

export type WorkflowPhaseProgress = {
  type: 'workflow_phase'
  index: number
  title: string
  kind?: 'child' // nested workflow() phase grouping
}

export type WorkflowLogProgress = {
  type: 'workflow_log'
  message: string
}

export type WorkflowProgress =
  | WorkflowAgentProgress
  | WorkflowPhaseProgress
  | WorkflowLogProgress

// Emitted by the engine to the Workflow tool's call() onProgress callback.
export type WorkflowProgressEvent = {
  type: 'progress'
  toolUseID: string
  data: WorkflowProgress
}

// ───────────────────────── hook options ─────────────────────────
// The `opts` bag accepted by agent() inside a workflow script.

export type WorkflowIsolation = 'worktree' | 'remote'

export type AgentHookOpts = {
  label?: string
  phase?: string
  schema?: Record<string, unknown>
  model?: string
  isolation?: WorkflowIsolation
  agentType?: string
  /** Override the stall timeout (ms) for this agent. */
  stallMs?: number
}

// ───────────────────────── budget ─────────────────────────
// The turn's shared token budget (from a "+500k"-style directive). null total
// means no target was set → remaining() is Infinity.

export type TokenBudget = {
  total: number | null
  getTurnSpent: () => number
}

export type FrozenBudget = {
  total: number | null
  spent: () => number
  remaining: () => number
}

// ───────────────────────── hooks bundle ─────────────────────────
// What the hook factory (createWorkflowHooks) returns. The script-facing
// globals (agent/parallel/pipeline/log/phase/workflow/args/budget) are
// assembled from this in runtime.ts (the vmContext assembler, ant PHK).

export type WorkflowHooks = {
  agent: (prompt: string, opts?: AgentHookOpts) => Promise<unknown>
  parallel: (thunks: Array<() => Promise<unknown>>) => Promise<unknown[]>
  pipeline: (
    items: unknown[],
    ...stages: Array<
      (prev: unknown, item: unknown, index: number) => Promise<unknown> | unknown
    >
  ) => Promise<unknown[]>
  log: (message: string) => void
  phase: (title: string) => void
  resolvePhase: (title: string, kind?: 'child') => number
  recordFailure: (msg: string) => void
  getAgentCount: () => number
  getFailures: () => string[]
  bindVMAwait: (fn: (v: unknown) => Promise<unknown>) => void
}

// ───────────────────────── result type for ZHK ─────────────────────────
export type WorkflowRunResult = {
  result: unknown
  agentCount: number
  logs: string[]
  failures: string[]
  durationMs: number
  error?: string
}

// ───────────────────────── journal (resume) ─────────────────────────
// ant 3885 H0_. Append-only record of agent() calls keyed by a hash of
// (prompt, opts). On resume, completed calls return their cached result
// instantly; only edited/new calls re-run.

export type JournalEntry =
  | { type: 'started'; key: string; agentId: string }
  | { type: 'result'; key: string; agentId: string; result: unknown }

export type JournalState = {
  results: Map<string, { agentId: string; result: unknown }>
  started: Map<string, JournalEntry[]>
}

export interface WorkflowJournal {
  load(): Promise<JournalState>
  append(entry: JournalEntry): Promise<void>
}

export type { WorkflowPhaseMeta }

// Result of one subagent attempt (runAgentAttempt / workflowAgentRun.ts).
export type AgentExecResult = {
  structured?: unknown
  text: string
  tokens: number
  toolCalls: number
  stalled: boolean
  stalledReason?: string
  skipped: boolean
  durationMs: number
  outputTokens?: number
  // Last assistant message's stop_reason — null when the turn ended without
  // one (the throttle signal: ant 3886 `aH` treats stopReason==null + tiny
  // output + long duration as a throttled/empty response).
  stopReason?: string | null
}
