/**
 * Per-worker state file r/w + timeline append.
 *
 * SINGLE state.json — aligned with ant 2.1.150. ant keeps ONE per-job state
 * file (`state.json`, ant `JJ8`/`xO`/`c7` @ 2514.js): the classifier, the
 * worker, the daemon and FleetView all read/write the same file. ccb used to
 * split into `state.json` (FleetJobState, worker/FleetView) + a separate
 * `classifier-state.json` (WorkerStateFile, classifier) — the two never
 * synced, so the classifier's empty `intent` clobbered nothing but FleetView
 * read the classifier's view inconsistently and the "current session" row
 * label never updated. Now the classifier writes the SAME state.json via a
 * merge that preserves the worker-owned fields (intent/name/worktree/…) and
 * only patches the classified fields (state/detail/tempo/needs/output).
 *
 * Layout (per worker `<short>`):
 *   ~/.claude/jobs/<short>/state.json     — the single source of truth
 *   ~/.claude/jobs/<short>/timeline.jsonl — append-only state-change log
 *
 * @dynamicRequire
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  getJobDir,
  readJobStateSync,
  writeJobStateSync,
} from '@claude-code/agent/background/fleet/fleetStore.js'
import type {
  FleetJobState,
  FleetJobStatus,
  FleetTempo,
} from '@claude-code/agent/background/fleet/fleetTypes.js'
import type { WorkerState, WorkerStateFile, WorkerTempo } from './state.js'

function getJobsRoot(): string {
  const root = process.env.CLAUDE_CONFIG_HOME
  return root ? join(root, 'jobs') : join(homedir(), '.claude', 'jobs')
}

function getTimelinePath(short: string): string {
  return join(getJobsRoot(), short, 'timeline.jsonl')
}

/** WorkerState has 'idle'/'crashed' which FleetJobStatus lacks; map them. */
function toFleetStatus(s: WorkerState): FleetJobStatus {
  if (s === 'idle') return 'working'
  if (s === 'crashed') return 'failed'
  return s
}

/**
 * Read the single state.json and present it in the classifier's
 * WorkerStateFile shape. Returns null when no state.json exists yet.
 */
export function readState(short: string): WorkerStateFile | null {
  const fleet = readJobStateSync(getJobDir(short))
  if (!fleet) return null
  return {
    state: fleet.state as WorkerState,
    detail: fleet.detail,
    tempo: fleet.tempo as WorkerTempo,
    needs: fleet.needs,
    output: fleet.output ?? undefined,
    classifySource:
      fleet.classifySource as WorkerStateFile['classifySource'],
    firstTerminalAt: fleet.firstTerminalAt ?? undefined,
    createdAt: fleet.createdAt,
    updatedAt: fleet.updatedAt,
    sessionId: fleet.sessionId,
    resumeSessionId: fleet.resumeSessionId,
    cliVersion: fleet.cliVersion,
    cwd: fleet.cwd,
    intent: fleet.intent,
    initialPrompt: fleet.initialPrompt,
    name: fleet.name,
    nameSource: fleet.nameSource,
    backend: fleet.backend,
    tokens: fleet.tokens,
  }
}

/**
 * Merge the classifier's view into the single state.json. Preserves all
 * worker-owned fields (children/template/respawnFlags/worktree/daemonShort/…)
 * and patches only the classified fields. Mirrors ant `OEH`→`xO` (4292.js:36
 * → 2514.js:64): one writer, one file.
 *
 * intent uses `??` (NOT `||`) so an empty-string intent on the incoming
 * partial never clobbers an existing one — matches ant `cb3:490`
 * `intent: k?.intent ?? M`.
 */
export function writeState(short: string, next: WorkerStateFile): void {
  const jobDir = getJobDir(short)
  const prev = readJobStateSync(jobDir)
  const now = next.updatedAt || new Date().toISOString()
  const merged: FleetJobState = {
    // worker-owned structural fields: keep prev, fall back to sane defaults
    output: next.output ?? prev?.output ?? null,
    children: prev?.children ?? null,
    linkScanOffset: prev?.linkScanOffset ?? 0,
    template: prev?.template ?? 'bg',
    routine: prev?.routine,
    respawnFlags: prev?.respawnFlags ?? [],
    daemonShort: prev?.daemonShort ?? short,
    worktreePath: prev?.worktreePath,
    worktreeBranch: prev?.worktreeBranch,
    worktreeHookBased: prev?.worktreeHookBased,
    originCwd: prev?.originCwd,
    pinned: prev?.pinned,
    block: prev?.block,
    suggestedReply: prev?.suggestedReply,
    inFlight: prev?.inFlight,
    color: prev?.color,
    sortOrder: prev?.sortOrder,
    stateSortOrder: prev?.stateSortOrder,
    // classified fields: patch from `next`
    state: toFleetStatus(next.state),
    tempo: next.tempo as FleetTempo,
    detail: next.detail,
    needs: next.needs,
    classifySource: next.classifySource,
    firstTerminalAt: next.firstTerminalAt ?? prev?.firstTerminalAt ?? null,
    // identity / seed fields: never clobber a non-empty existing value
    intent: prev?.intent ?? next.intent ?? '',
    initialPrompt: prev?.initialPrompt ?? next.initialPrompt,
    name: prev?.name ?? next.name,
    nameSource: prev?.nameSource ?? (next.nameSource as FleetJobState['nameSource']),
    sessionId: next.sessionId ?? prev?.sessionId ?? '',
    resumeSessionId: next.resumeSessionId ?? prev?.resumeSessionId,
    cwd: next.cwd || prev?.cwd || '',
    cliVersion: next.cliVersion ?? prev?.cliVersion,
    tokens: next.tokens ?? prev?.tokens,
    backend: 'daemon',
    createdAt: prev?.createdAt ?? next.createdAt ?? now,
    updatedAt: now,
  }
  writeJobStateSync(jobDir, merged)
}

export function appendTimeline(
  short: string,
  entry: { at: string; state: string; detail: string; text?: string },
): void {
  try {
    mkdirSync(join(getJobsRoot(), short), { recursive: true, mode: 0o700 })
    appendFileSync(getTimelinePath(short), JSON.stringify(entry) + '\n', {
      mode: 0o600,
    })
  } catch {
    // best-effort
  }
}
