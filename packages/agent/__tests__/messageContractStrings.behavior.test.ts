import { describe, expect, test } from 'bun:test'

import {
  AUTO_REJECT_MESSAGE,
  CANCEL_MESSAGE,
  DENIAL_WORKAROUND_GUIDANCE,
  DONT_ASK_REJECT_MESSAGE,
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  NO_RESPONSE_REQUESTED,
  PLAN_REJECTION_PREFIX,
  REJECT_MESSAGE,
  REJECT_MESSAGE_WITH_REASON_PREFIX,
  SUBAGENT_REJECT_MESSAGE,
  SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX,
  SYNTHETIC_TOOL_RESULT_PLACEHOLDER,
} from '../messages.ts'

/**
 * Pin the EXACT wire format of protocol strings between Claude Code and
 * the model. Three classes of constants here:
 *
 *  1. Interrupt/cancel: the model sees these as user-role messages and
 *     uses the EXACT prefix to decide whether to give up the turn vs ask.
 *  2. Rejection messages: tell the model the tool didn't run AND give
 *     guidance on whether to retry/find a workaround/abort.
 *  3. Placeholders: synthetic content the API stream injects to keep
 *     tool_use/tool_result pairing structurally valid — must be
 *     recognizable so HFI rejects them at submission time.
 *
 * Any string drift here changes how the model behaves in interrupt /
 * permission-deny scenarios. A "let's simplify the wording" refactor
 * has caused production behavior regressions before — pin them.
 */
describe('Message contract strings (Claude Code ↔ model protocol)', () => {
  describe('interrupt + cancel', () => {
    test('INTERRUPT_MESSAGE matches the exact bracket format', () => {
      expect(INTERRUPT_MESSAGE).toBe('[Request interrupted by user]')
    })

    test('INTERRUPT_MESSAGE_FOR_TOOL_USE distinguishes mid-tool interrupt', () => {
      // Used when the user hits Ctrl-C while a tool is executing.
      // Model needs to know it was specifically the TOOL that got cancelled.
      expect(INTERRUPT_MESSAGE_FOR_TOOL_USE).toBe(
        '[Request interrupted by user for tool use]',
      )
    })

    test('CANCEL_MESSAGE explicitly says STOP (capitalized) so model halts', () => {
      // The "STOP" capitalization is a load-bearing convention — the model
      // pays attention to it as a hard halt signal.
      expect(CANCEL_MESSAGE).toContain('STOP what you are doing')
      expect(CANCEL_MESSAGE).toContain('wait for the user to tell you how to proceed')
    })
  })

  describe('rejection messages', () => {
    test('REJECT_MESSAGE mentions tool was rejected AND example of file-edit non-write', () => {
      // The "(eg. if it was a file edit, the new_string was NOT written
      // to the file)" parenthetical is what stops the model from
      // assuming the edit DID write. Drop this and edit-and-verify
      // sessions desync after a deny.
      expect(REJECT_MESSAGE).toContain('was rejected')
      expect(REJECT_MESSAGE).toContain('the new_string was NOT written to the file')
      expect(REJECT_MESSAGE).toContain('STOP')
    })

    test('REJECT_MESSAGE_WITH_REASON_PREFIX ends in newline (caller appends reason)', () => {
      expect(REJECT_MESSAGE_WITH_REASON_PREFIX).toMatch(/\n$/)
      expect(REJECT_MESSAGE_WITH_REASON_PREFIX).toContain('the user said:')
    })

    test('SUBAGENT_REJECT_MESSAGE tells the subagent to FALLBACK or REPORT', () => {
      // Subagent rejections are different from user rejections — the
      // user can't intervene, so the subagent must adapt or report.
      // Pin the "Try a different approach or report" guidance.
      expect(SUBAGENT_REJECT_MESSAGE).toContain('was rejected')
      expect(SUBAGENT_REJECT_MESSAGE).toContain('Try a different approach or report the limitation')
    })

    test('SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX ends in newline', () => {
      expect(SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX).toMatch(/\n$/)
    })

    test('PLAN_REJECTION_PREFIX mentions plan mode + rejected plan visibility', () => {
      // After rejecting plan, the rejected plan content is appended.
      // Pin both the structural prefix AND the "Rejected plan:\n" marker.
      expect(PLAN_REJECTION_PREFIX).toContain('proposed a plan that was rejected')
      expect(PLAN_REJECTION_PREFIX).toContain('Rejected plan:\n')
    })
  })

  describe('denial workaround guidance', () => {
    test('DENIAL_WORKAROUND_GUIDANCE has the IMPORTANT prefix the model attends to', () => {
      expect(DENIAL_WORKAROUND_GUIDANCE).toMatch(/^IMPORTANT:/)
    })

    test('DENIAL_WORKAROUND_GUIDANCE allows benign workarounds but forbids bypass', () => {
      // Two pinned phrases that calibrate model behavior:
      // - "naturally be used to accomplish this goal" → allow head-vs-cat
      // - "do not attempt to bypass the intent" → forbid evasion
      expect(DENIAL_WORKAROUND_GUIDANCE).toContain('naturally be used to accomplish this goal')
      expect(DENIAL_WORKAROUND_GUIDANCE).toContain('should not* attempt to work around this denial in malicious ways')
      expect(DENIAL_WORKAROUND_GUIDANCE).toContain('bypass the intent behind this denial')
    })

    test('AUTO_REJECT_MESSAGE composes tool name + workaround guidance', () => {
      const msg = AUTO_REJECT_MESSAGE('Bash')
      expect(msg).toContain('Permission to use Bash has been denied.')
      expect(msg).toContain(DENIAL_WORKAROUND_GUIDANCE)
    })

    test('DONT_ASK_REJECT_MESSAGE mentions "don\'t ask mode" for self-explanatory denial', () => {
      const msg = DONT_ASK_REJECT_MESSAGE('Write')
      expect(msg).toContain("Claude Code is running in don't ask mode")
      expect(msg).toContain('Permission to use Write has been denied')
    })
  })

  describe('placeholders', () => {
    test('NO_RESPONSE_REQUESTED is the bare string (no leading space, no period adjustment)', () => {
      expect(NO_RESPONSE_REQUESTED).toBe('No response requested.')
    })

    test('SYNTHETIC_TOOL_RESULT_PLACEHOLDER is recognizable + non-empty', () => {
      // HFI rejects payloads containing this string. Pin the exact value
      // so a refactor can't silently make the rejection check miss real
      // synthetic placeholders.
      expect(SYNTHETIC_TOOL_RESULT_PLACEHOLDER).toBe(
        '[Tool result missing due to internal error]',
      )
      expect(SYNTHETIC_TOOL_RESULT_PLACEHOLDER.length).toBeGreaterThan(0)
    })
  })
})
