/**
 * Port of ant v2.1.136 Ak (2642.js) — wrapper around the structured OTel
 * `at_mention` event helper. Extracted from attachments.ts so the call
 * sites stay one-liners and attachments.ts stays under its grandfather
 * LOC budget.
 */

import { logAtMentionEvent } from '@claude-code/local-observability/telemetry'

export type AtMentionType = 'file' | 'directory'

export function emitAtMention(mentionType: AtMentionType, success: boolean): void {
  void logAtMentionEvent({ mentionType, success })
}
