// Leaf module: pure type guards + ephemeral-tool-progress predicate.
// Extracted from sessionStorage.ts (#132) so consumers that only need the
// predicates don't drag in the full ~5K-LOC sessionStorage barrel (and its
// transitive heavyweight deps: provider/sessionIngress, agent/messages,
// agent/concurrentSessions, etc.).

import { feature } from 'bun:bundle'
import type { Entry, TranscriptMessage } from '@claude-code/agent/logsTypes.js'
import type { Message } from '@claude-code/agent/messageShapes'

/**
 * Type guard: transcript messages are user/assistant/attachment/system.
 * Single source of truth for what counts as a transcript message —
 * loadTranscriptFile uses this to decide what loads into the chain.
 *
 * Progress messages are NOT transcript messages. They are ephemeral UI
 * state and must not be persisted to JSONL or participate in parentUuid
 * chains; doing so caused chain forks that orphaned real conversation
 * messages on resume (see #14373, #23537).
 */
export function isTranscriptMessage(entry: Entry): entry is TranscriptMessage {
  return (
    entry.type === 'user' ||
    entry.type === 'assistant' ||
    entry.type === 'attachment' ||
    entry.type === 'system'
  )
}

/**
 * Entries that participate in the parentUuid chain. Used on the write path
 * (insertMessageChain, useLogMessages) to skip progress when assigning
 * parentUuid. Old transcripts with progress already in the chain are
 * handled by the progressBridge rewrite in loadTranscriptFile.
 */
export function isChainParticipant(m: Pick<Message, 'type'>): boolean {
  return m.type !== 'progress'
}

/**
 * High-frequency tool progress ticks (1/sec for Sleep, per-chunk for Bash).
 * UI-only: not sent to the API, not rendered after the tool completes.
 * Used by REPL.tsx to replace-in-place instead of appending, and by
 * loadTranscriptFile to skip legacy entries from old transcripts.
 */
const EPHEMERAL_PROGRESS_TYPES = new Set([
  'bash_progress',
  'powershell_progress',
  'mcp_progress',
  ...(feature('PROACTIVE') || feature('KAIROS')
    ? (['sleep_progress'] as const)
    : []),
])

export function isEphemeralToolProgress(dataType: unknown): boolean {
  return typeof dataType === 'string' && EPHEMERAL_PROGRESS_TYPES.has(dataType)
}
