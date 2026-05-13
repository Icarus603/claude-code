/**
 * Port of ant v2.1.136 D_7 (2911.js) — `system_prompt` structured OTel event.
 *
 * Hash the system prompt (sha256 first 12 hex chars, prefixed `sp_`), then
 * fire once per unique hash per process (dedup is process-local; restarting
 * the binary re-emits the first prompt of the new session).
 *
 * Content body is gated on OTEL_LOG_USER_PROMPTS via the structuredEvents
 * helper — when off, we still emit hash + length so dashboards see the
 * count, just not the content. Truncated at 60KB (`MAX_PROMPT_CONTENT`)
 * matching ant `wK5 = 61440`.
 */

import { createHash } from 'crypto'

import {
  logSystemPromptEvent,
  toolDetailsLoggingEnabled,
} from '@claude-code/local-observability/telemetry'

const MAX_PROMPT_CONTENT = 61440 // ant wK5 (2911.js)
const TRUNCATED_SUFFIX = '\n\n[TRUNCATED - Content exceeds 60KB limit]'

const seenHashes = new Set<string>()

function hashPrompt(content: string): string {
  return `sp_${createHash('sha256').update(content).digest('hex').slice(0, 12)}`
}

function truncate(content: string): { content: string; truncated: boolean } {
  if (content.length <= MAX_PROMPT_CONTENT) {
    return { content, truncated: false }
  }
  return {
    content: content.slice(0, MAX_PROMPT_CONTENT) + TRUNCATED_SUFFIX,
    truncated: true,
  }
}

/**
 * Emit `system_prompt` OTel event. No-op if:
 *   1. The prompt content is empty / undefined.
 *   2. We've already emitted for this hash in this process.
 *   3. Tool-detail logging is off AND content body would have been omitted.
 *      (We still hash + emit length so dashboards count unique prompts.)
 *
 * Returns the computed hash so callers can also stamp it on a span if they
 * want — matches ant's pattern of setting `system_prompt_hash` on the
 * surrounding span regardless of dedup.
 */
export function maybeEmitSystemPromptEvent(content: string | undefined): string | null {
  if (!content) return null
  const hash = hashPrompt(content)
  if (seenHashes.has(hash)) return hash
  seenHashes.add(hash)
  const { content: body, truncated } = truncate(content)
  void logSystemPromptEvent({
    hash,
    // Redact content body if operator hasn't opted in. Hash + length still flow.
    content: toolDetailsLoggingEnabled() ? body : '<REDACTED>',
    length: content.length,
    truncated,
  })
  return hash
}

/** Test-only: clear the dedup cache so tests can re-emit. */
export function __resetSystemPromptDedupForTest(): void {
  seenHashes.clear()
}
