// Leaf module: path helpers for session JSONL storage. Extracted from
// sessionStorage.ts (#132) so callers that only need to compute paths
// (e.g. hooks.ts createBaseHookInput, save* functions) don't pull in the
// full ~5K-LOC barrel.
//
// All functions here are deterministic given session state (sessionId,
// originalCwd, sessionProjectDir). No I/O, no Project singleton.

import memoize from 'lodash-es/memoize.js'
import { join } from 'path'
import {
  getOriginalCwd,
  getSessionId,
  getSessionProjectDir,
} from '@claude-code/app-host/bootstrap/state.js'
import { getClaudeConfigHomeDir } from '@claude-code/config/env/utils'
import { sanitizePath } from './path.js'
import type { AgentId } from '@claude-code/agent/idTypes'

export function getProjectsDir(): string {
  return join(getClaudeConfigHomeDir(), 'projects')
}

// Memoized: called 12+ times per turn via hooks.ts createBaseHookInput
// (PostToolUse path, 5×/turn) + various save* functions. Input is a cwd
// string; homedir/env/regex are all session-invariant so the result is
// stable for a given input. Worktree switches just change the key — no
// cache clear needed.
export const getProjectDir = memoize((projectDir: string): string => {
  return join(getProjectsDir(), sanitizePath(projectDir))
})

export function getTranscriptPath(): string {
  const projectDir = getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
  return join(projectDir, `${getSessionId()}.jsonl`)
}

/**
 * Resolve the JSONL path for an arbitrary session id. For the *current*
 * session we honor sessionProjectDir (set by switchActiveSession on
 * resume/branch) — the same way getTranscriptPath() does. Without this,
 * hooks get a transcript_path computed from originalCwd while the actual
 * file was written to sessionProjectDir, so the hook sees MISSING
 * (gh-30217).
 *
 * For OTHER session IDs we can only guess via originalCwd — we don't
 * track a sessionId→projectDir map. Callers wanting a specific other
 * session's path should pass fullPath explicitly (most save* functions
 * already accept this).
 */
export function getTranscriptPathForSession(sessionId: string): string {
  if (sessionId === getSessionId()) {
    return getTranscriptPath()
  }
  const projectDir = getProjectDir(getOriginalCwd())
  return join(projectDir, `${sessionId}.jsonl`)
}

// 50 MB — session JSONL can grow to multiple GB (inc-3930). Callers that
// read the raw transcript must bail out above this threshold to avoid OOM.
export const MAX_TRANSCRIPT_READ_BYTES = 50 * 1024 * 1024

// In-memory map of agentId → subdirectory for grouping related subagent
// transcripts (e.g. workflow runs write to subagents/workflows/<runId>/).
// Populated before the agent runs; consulted by getAgentTranscriptPath.
const agentTranscriptSubdirs = new Map<string, string>()

export function setAgentTranscriptSubdir(
  agentId: string,
  subdir: string,
): void {
  agentTranscriptSubdirs.set(agentId, subdir)
}

export function clearAgentTranscriptSubdir(agentId: string): void {
  agentTranscriptSubdirs.delete(agentId)
}

export function getAgentTranscriptPath(agentId: AgentId): string {
  // Same sessionProjectDir consistency as getTranscriptPathForSession —
  // subagent transcripts live under the session dir, so if the session
  // transcript is at sessionProjectDir, subagent transcripts are too.
  const projectDir = getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
  const sessionId = getSessionId()
  const subdir = agentTranscriptSubdirs.get(agentId)
  const base = subdir
    ? join(projectDir, sessionId, 'subagents', subdir)
    : join(projectDir, sessionId, 'subagents')
  return join(base, `agent-${agentId}.jsonl`)
}
