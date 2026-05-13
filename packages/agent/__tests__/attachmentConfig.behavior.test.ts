import { describe, expect, test } from 'bun:test'

import {
  AUTO_MODE_ATTACHMENT_CONFIG,
  PLAN_MODE_ATTACHMENT_CONFIG,
  RELEVANT_MEMORIES_CONFIG,
  TODO_REMINDER_CONFIG,
  VERIFY_PLAN_REMINDER_CONFIG,
} from '../attachments.ts'

/**
 * Pin attachment-cadence and memory-surfacing constants. These govern
 * how often Claude Code re-injects system reminders mid-session:
 * - Too frequent → context bloat (every turn carrying reminder bytes)
 * - Too rare → model "forgets" mode constraints (plan-mode escapes)
 *
 * Memory byte caps are load-bearing safety limits:
 * - MAX_MEMORY_BYTES caps per-file injection (prevent 100KB CLAUDE.md
 *   from busting the context window in one turn)
 * - MAX_SESSION_BYTES caps cumulative surfacing across a long session
 *   so the prefetcher doesn't keep finding "more relevant" memories
 *   forever
 *
 * If any of these constants drift, tune-the-knobs decisions get silently
 * lost and behavior reverts to bad defaults.
 */
describe('Attachment cadence + memory-surfacing config', () => {
  test('TODO_REMINDER_CONFIG: 10 turns since last write → reminder', () => {
    expect(TODO_REMINDER_CONFIG.TURNS_SINCE_WRITE).toBe(10)
    expect(TODO_REMINDER_CONFIG.TURNS_BETWEEN_REMINDERS).toBe(10)
  })

  test('PLAN_MODE_ATTACHMENT_CONFIG: reminder every 5 turns, full every 5 reminders', () => {
    expect(PLAN_MODE_ATTACHMENT_CONFIG.TURNS_BETWEEN_ATTACHMENTS).toBe(5)
    expect(PLAN_MODE_ATTACHMENT_CONFIG.FULL_REMINDER_EVERY_N_ATTACHMENTS).toBe(5)
  })

  test('AUTO_MODE_ATTACHMENT_CONFIG matches plan-mode cadence', () => {
    // Pin the parity — if these drift, /plan and auto-mode would have
    // different model-attention profiles which the prompt is calibrated against.
    expect(AUTO_MODE_ATTACHMENT_CONFIG.TURNS_BETWEEN_ATTACHMENTS).toBe(
      PLAN_MODE_ATTACHMENT_CONFIG.TURNS_BETWEEN_ATTACHMENTS,
    )
    expect(AUTO_MODE_ATTACHMENT_CONFIG.FULL_REMINDER_EVERY_N_ATTACHMENTS).toBe(
      PLAN_MODE_ATTACHMENT_CONFIG.FULL_REMINDER_EVERY_N_ATTACHMENTS,
    )
  })

  test('VERIFY_PLAN_REMINDER_CONFIG: 10 turns (matches TODO reminder cadence)', () => {
    expect(VERIFY_PLAN_REMINDER_CONFIG.TURNS_BETWEEN_REMINDERS).toBe(10)
  })

  test('RELEVANT_MEMORIES_CONFIG: 60KB cumulative cap (~3 full 20KB injections)', () => {
    // 60 × 1024 = 61_440. Pin the byte-math comment in the source: "5×4KB
    // per turn = 20KB; budget = 3 full injections; thereafter most-relevant
    // memories are already in context."
    expect(RELEVANT_MEMORIES_CONFIG.MAX_SESSION_BYTES).toBe(60 * 1024)
  })
})
