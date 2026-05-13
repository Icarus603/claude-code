import { describe, expect, test } from 'bun:test'

import {
  CANCEL_MESSAGE,
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  NO_RESPONSE_REQUESTED,
  REJECT_MESSAGE,
  SYNTHETIC_MESSAGES,
  SYNTHETIC_MODEL,
} from '../messages.ts'

/**
 * Pin SYNTHETIC_MESSAGES set membership. These are the literal strings
 * that isSyntheticMessage uses to detect "this is a synthetic UI hint,
 * not real model output". Drift creates two failure modes:
 *  1. NEW user-message text drifts away from the set → synthetic msgs
 *     bleed into compaction/usage analytics as real model output
 *  2. Set adds unrelated string → real model output that happens to match
 *     gets filtered out (data loss)
 */
describe('SYNTHETIC_MESSAGES set + sentinel model', () => {
  test('SYNTHETIC_MODEL = "<synthetic>" sentinel (NOT a real model id)', () => {
    expect(SYNTHETIC_MODEL).toBe('<synthetic>')
  })

  test('contains INTERRUPT_MESSAGE', () => {
    expect(SYNTHETIC_MESSAGES.has(INTERRUPT_MESSAGE)).toBe(true)
  })

  test('contains INTERRUPT_MESSAGE_FOR_TOOL_USE (separate from regular interrupt)', () => {
    expect(SYNTHETIC_MESSAGES.has(INTERRUPT_MESSAGE_FOR_TOOL_USE)).toBe(true)
  })

  test('contains CANCEL_MESSAGE', () => {
    expect(SYNTHETIC_MESSAGES.has(CANCEL_MESSAGE)).toBe(true)
  })

  test('contains REJECT_MESSAGE', () => {
    expect(SYNTHETIC_MESSAGES.has(REJECT_MESSAGE)).toBe(true)
  })

  test('contains NO_RESPONSE_REQUESTED', () => {
    expect(SYNTHETIC_MESSAGES.has(NO_RESPONSE_REQUESTED)).toBe(true)
  })

  test('size is exactly 5 (pin against silent additions)', () => {
    expect(SYNTHETIC_MESSAGES.size).toBe(5)
  })

  test('does NOT contain partial / similar text (only EXACT matches)', () => {
    // The check uses Set.has(), not substring matching. Pin both
    // directions: superstrings AND substrings of synthetic msgs must
    // NOT be detected as synthetic.
    expect(SYNTHETIC_MESSAGES.has('[Request interrupted by user]\n')).toBe(false)
    expect(SYNTHETIC_MESSAGES.has('Request interrupted by user')).toBe(false) // missing brackets
    expect(SYNTHETIC_MESSAGES.has(INTERRUPT_MESSAGE.toLowerCase())).toBe(false) // case-sensitive
  })

  test('NOT contained: REJECT_MESSAGE_WITH_REASON_PREFIX (variant, gets user-supplied suffix)', () => {
    // The "with reason" variant is dynamic (user supplies the suffix), so
    // it can't be in a static Set. The REJECT_MESSAGE without suffix IS
    // in the set. Pin so a future refactor that adds the prefix to the
    // set (creating a substring-match-via-set hack) doesn't slip through.
    expect(
      SYNTHETIC_MESSAGES.has(
        "The user doesn't want to proceed with this tool use. To tell you how to proceed, the user said:\n",
      ),
    ).toBe(false)
  })
})
