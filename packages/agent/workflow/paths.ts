// Workflow filesystem paths. Port of ant 2.1.150 path helpers from module Hv
// (3884.js: NaH/oe7/gj3) and SY (2191.js: se_/Ve1/mx9/vA_/pKH).
//
// Two storage areas, both under the session's project dir:
//  - journal dir   <projectDir>/<sessionId>/subagents/workflows/<runId>/
//                  → journal.jsonl (resume) + agent-*.jsonl (subagent transcripts,
//                    routed there by runAgent's transcriptSubdir=workflows/<runId>)
//  - snapshot dir  <projectDir>/<sessionId>/workflows/
//                  → <runId>.json (one completed-run snapshot, read by /workflows)
//
// Persisted workflow SCRIPTS (for the scriptPath iterate-and-resume flow) live
// under the cwd at .claude/workflows/scripts/<name>-<runId>.js (ant se_/Ve1).

import { join } from 'node:path'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import {
  getOriginalCwd,
  getSessionId,
  getSessionProjectDir,
} from '@claude-code/app-host/bootstrap/state.js'
import { getProjectDir } from '@claude-code/storage/sessionStorage.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'

// ant Mp — max workflow script size.
export const MAX_WORKFLOW_SCRIPT_BYTES = 524_288

function sessionDir(): string {
  const projectDir = getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
  return join(projectDir, getSessionId())
}

/** ant NaH — journal + subagent-transcript dir for a run. */
export function getWorkflowRunDir(runId: string): string {
  return join(sessionDir(), 'subagents', 'workflows', runId)
}

/** ant oe7 — snapshot dir (one <runId>.json per completed run). */
export function getWorkflowSnapshotDir(): string {
  return join(sessionDir(), 'workflows')
}

/** ant gj3 — snapshot path for a run. */
export function getWorkflowSnapshotPath(runId: string): string {
  return join(getWorkflowSnapshotDir(), `${runId}.json`)
}

// ant pKH — slugify a name for the persisted script filename.
export function slugifyWorkflowName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workflow'
  )
}

// ant se_ — persisted-scripts dir under cwd.
function scriptsDir(): string {
  return join(getOriginalCwd(), '.claude', 'workflows', 'scripts')
}

// ant Ve1 — persisted script path for (name, runId).
export function getPersistedScriptPath(name: string, runId: string): string {
  return join(scriptsDir(), `${slugifyWorkflowName(name)}-${runId}.js`)
}

/**
 * ant mx9 — persist a workflow script to disk (fire-and-forget). Returns the
 * path synchronously so the tool result can advertise it immediately.
 */
export function persistWorkflowScript(
  name: string,
  runId: string,
  script: string,
): string {
  const dir = scriptsDir()
  const path = getPersistedScriptPath(name, runId)
  void (async () => {
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 })
      await writeFile(path, script, { encoding: 'utf-8', mode: 0o600 })
    } catch (e) {
      logForDebugging(`Failed to persist workflow script to ${path}: ${e}`)
    }
  })()
  return path
}

export type ReadScriptResult = { script: string; path: string } | { error: string }

/** ant vA_ — read a workflow script file (resolved against cwd). */
export async function readWorkflowScriptFile(
  scriptPath: string,
): Promise<ReadScriptResult> {
  const resolved = join(getOriginalCwd(), scriptPath)
  try {
    const script = await readFile(resolved, { encoding: 'utf-8' })
    if (script.length > MAX_WORKFLOW_SCRIPT_BYTES) {
      return {
        error: `Workflow script file ${resolved} is ${script.length} bytes; max ${MAX_WORKFLOW_SCRIPT_BYTES}`,
      }
    }
    return { script, path: resolved }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      return { error: `Workflow script file not found: ${resolved}` }
    }
    return { error: `Failed to read workflow script file ${resolved}: ${e}` }
  }
}

// ─────────────────── snapshot persist / history (ant ae7 / se7) ───────────────────

export type WorkflowSnapshot = {
  runId: string
  taskId: string
  timestamp: string
  script: string
  scriptPath?: string
  args?: unknown
  result?: unknown
  agentCount: number
  logs: string[]
  durationMs: number
  error?: string
  summary?: string
  workflowName?: string
  status: string
  startTime: number
  phases?: Array<{ title: string; detail?: string; model?: string }>
  defaultModel?: string
  workflowProgress?: unknown[]
  totalTokens: number
  totalToolCalls: number
}

/** ant ae7 — write a completed-run snapshot. */
export async function writeWorkflowSnapshot(
  runId: string,
  data: Omit<WorkflowSnapshot, 'runId' | 'timestamp'>,
): Promise<void> {
  try {
    const snapshot: WorkflowSnapshot = {
      runId,
      timestamp: new Date().toISOString(),
      ...data,
    }
    const path = getWorkflowSnapshotPath(runId)
    await mkdir(getWorkflowSnapshotDir(), { recursive: true, mode: 0o700 })
    await writeFile(path, JSON.stringify(snapshot), {
      encoding: 'utf8',
      mode: 0o600,
    })
  } catch (e) {
    logForDebugging(`Failed to write workflow snapshot ${runId}: ${e}`)
  }
}

/** ant se7 — read + sort all run snapshots (newest first). For /workflows. */
export async function readAllWorkflowSnapshots(): Promise<WorkflowSnapshot[]> {
  const dir = getWorkflowSnapshotDir()
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const snapshots = (
    await Promise.all(
      entries
        .filter(f => f.endsWith('.json'))
        .map(async (f): Promise<WorkflowSnapshot | null> => {
          try {
            const raw = await readFile(join(dir, f), 'utf8')
            const t = JSON.parse(raw) as Partial<WorkflowSnapshot>
            const runId = t.runId ?? f.replace(/\.json$/, '')
            return {
              runId,
              taskId: t.taskId ?? runId,
              timestamp: t.timestamp ?? new Date(0).toISOString(),
              script: t.script ?? '',
              scriptPath: t.scriptPath,
              args: t.args,
              result: t.result,
              agentCount: t.agentCount ?? 0,
              logs: t.logs ?? [],
              durationMs: t.durationMs ?? 0,
              error: t.error,
              summary: t.summary,
              workflowName: t.workflowName,
              status: t.status ?? (t.error ? 'failed' : 'completed'),
              startTime:
                t.startTime ?? (Date.parse(t.timestamp ?? '') || 0),
              phases: t.phases,
              defaultModel: t.defaultModel,
              workflowProgress: t.workflowProgress ?? [],
              totalTokens: t.totalTokens ?? 0,
              totalToolCalls: t.totalToolCalls ?? 0,
            }
          } catch (e) {
            logForDebugging(`Failed to parse workflow snapshot ${f}: ${e}`)
            return null
          }
        }),
    )
  ).filter((s): s is WorkflowSnapshot => s !== null)
  snapshots.sort((a, b) => b.startTime - a.startTime)
  return snapshots
}
