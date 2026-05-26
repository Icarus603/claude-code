// Workflow resume journal. Port of ant 2.1.150 module H0_ (3885.js).
//
// An append-only journal.jsonl records every agent() call's start and result,
// keyed by a stable hash of (workflowRunId, prompt, opts). On resume
// (Workflow({scriptPath, resumeFromRunId})), the longest unchanged PREFIX of
// agent() calls returns its cached result instantly; the first edited/new call
// and everything after runs live. Same script + same args → 100% cache hit.
//
// The cache key folds in a running prefix (each key includes the prior key) so
// that two structurally-identical agent() calls at different points in the
// script get distinct keys — replay is position-sensitive, matching ant.

import { createHash } from 'node:crypto'
import { mkdir, appendFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { getWorkflowRunDir } from './paths.js'
import type {
  AgentHookOpts,
  JournalEntry,
  JournalState,
  WorkflowJournal,
} from './types.js'

// ant Qj3 — journal format version. Bump invalidates old journals.
const JOURNAL_VERSION = 'v2'

// Stable-stringify the cache-relevant subset of agent() opts. ant dj3 —
// only schema/model/isolation/agentType matter; label/phase/stallMs are
// display-only and must NOT affect the key (so relabeling doesn't bust resume).
function stableStringifyOpts(opts?: AgentHookOpts): string {
  if (!opts) return '{}'
  const subset: Record<string, unknown> = {}
  for (const k of ['schema', 'model', 'isolation', 'agentType'] as const) {
    const v = opts[k]
    if (v === undefined || typeof v === 'function') continue
    subset[k] = v
  }
  const sortDeep = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(sortDeep)
    if (o && typeof o === 'object') {
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(o as Record<string, unknown>).sort()) {
        out[key] = sortDeep((o as Record<string, unknown>)[key])
      }
      return out
    }
    return o
  }
  return JSON.stringify(sortDeep(subset))
}

/**
 * ant HHK — compute the resume cache key for an agent() call.
 * key = sha256(prefix \0 prompt \0 stableOpts), tagged with the version.
 * `prefix` is the prior call's key (position sensitivity).
 */
export function computeAgentCacheKey(
  prompt: string,
  opts: AgentHookOpts | undefined,
  prefix: string,
): string {
  const hash = createHash('sha256')
    .update(prefix)
    .update('\x00')
    .update(prompt)
    .update('\x00')
    .update(stableStringifyOpts(opts))
    .digest('hex')
  return `${JOURNAL_VERSION}:${hash}`
}

// ant te7 — index raw journal entries into results + started maps.
function indexEntries(entries: JournalEntry[]): JournalState {
  const results = new Map<string, { agentId: string; result: unknown }>()
  const started = new Map<string, JournalEntry[]>()
  for (const e of entries) {
    if (e.type === 'result') {
      results.set(e.key, { agentId: e.agentId, result: e.result })
    } else if (e.type === 'started') {
      const list = started.get(e.key)
      if (list) list.push(e)
      else started.set(e.key, [e])
    }
  }
  return { results, started }
}

/**
 * ant Zb8 — append-only journal backed by journal.jsonl in the run dir.
 */
export class FileWorkflowJournal implements WorkflowJournal {
  readonly path: string
  private dirReady = false

  constructor(runId: string) {
    this.path = join(getWorkflowRunDir(runId), 'journal.jsonl')
  }

  async load(): Promise<JournalState> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code === 'ENOENT') return indexEntries([])
      throw e
    }
    const entries: JournalEntry[] = []
    for (const line of raw.split('\n')) {
      if (!line) continue
      try {
        entries.push(JSON.parse(line) as JournalEntry)
      } catch (e) {
        logForDebugging(
          `FileWorkflowJournal: skipping unparseable line in ${this.path}: ${e}`,
        )
      }
    }
    return indexEntries(entries)
  }

  async append(entry: JournalEntry): Promise<void> {
    if (!this.dirReady) {
      await mkdir(dirname(this.path), { recursive: true })
      this.dirReady = true
    }
    await appendFile(this.path, `${JSON.stringify(entry)}\n`, 'utf8')
  }
}
