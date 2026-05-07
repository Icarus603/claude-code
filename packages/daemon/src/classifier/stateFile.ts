/**
 * Per-worker classifier state file r/w + timeline append.
 *
 * Layout (per worker `<short>`):
 *   ~/.claude/jobs/<short>/classifier-state.json — current state
 *   ~/.claude/jobs/<short>/timeline.jsonl       — append-only state-change log
 *
 * @dynamicRequire
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { WorkerStateFile } from './state.js'

function getJobsRoot(): string {
  const root = process.env.CLAUDE_CONFIG_HOME
  return root ? join(root, 'jobs') : join(homedir(), '.claude', 'jobs')
}

function getStatePath(short: string): string {
  return join(getJobsRoot(), short, 'classifier-state.json')
}

function getTimelinePath(short: string): string {
  return join(getJobsRoot(), short, 'timeline.jsonl')
}

export function readState(short: string): WorkerStateFile | null {
  const path = getStatePath(short)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as WorkerStateFile
  } catch {
    return null
  }
}

export function writeState(short: string, state: WorkerStateFile): void {
  const path = getStatePath(short)
  try {
    mkdirSync(join(getJobsRoot(), short), { recursive: true, mode: 0o700 })
    writeFileSync(path, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
  } catch {
    // best-effort
  }
}

export function appendTimeline(
  short: string,
  entry: { at: string; state: string; detail: string; text?: string },
): void {
  try {
    mkdirSync(join(getJobsRoot(), short), { recursive: true, mode: 0o700 })
    appendFileSync(getTimelinePath(short), JSON.stringify(entry) + '\n', { mode: 0o600 })
  } catch {
    // best-effort
  }
}
