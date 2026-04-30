import { describe, expect, test } from 'bun:test'
import { TEAMMATE_SYSTEM_PROMPT_ADDENDUM } from '../teammatePromptAddendum.js'

describe('TEAMMATE_SYSTEM_PROMPT_ADDENDUM — contract anchor', () => {
  // Why this exists: this string is appended to every teammate's system
  // prompt. If someone deletes the SendMessage instruction, teammates
  // silently fall back to "writing text" which is invisible to other
  // teammates — a previous regression we want to lock in.

  test('mentions the SendMessage tool by name', () => {
    expect(TEAMMATE_SYSTEM_PROMPT_ADDENDUM).toContain('SendMessage tool')
  })

  test('documents the per-teammate `to: "<name>"` form', () => {
    expect(TEAMMATE_SYSTEM_PROMPT_ADDENDUM).toContain('to: "<name>"')
  })

  test('documents the broadcast `to: "*"` form', () => {
    expect(TEAMMATE_SYSTEM_PROMPT_ADDENDUM).toContain('to: "*"')
  })

  test('warns broadcast (`to: "*"`) is sparingly-used', () => {
    expect(TEAMMATE_SYSTEM_PROMPT_ADDENDUM).toMatch(/sparingly/i)
  })

  test('explicitly states that text without SendMessage is invisible', () => {
    expect(TEAMMATE_SYSTEM_PROMPT_ADDENDUM).toMatch(
      /not visible to others|MUST use the SendMessage/i,
    )
  })

  test('addresses the user / team-lead distinction', () => {
    expect(TEAMMATE_SYSTEM_PROMPT_ADDENDUM).toMatch(/team lead/i)
  })
})

describe('TEAMMATE_SYSTEM_PROMPT_ADDENDUM — protocol responses contract', () => {
  // Why this section exists: the operator's 2026-04-30 e2e probe hit
  // a deadlock when worker-c received a shutdown_request and replied
  // with plain-text "Acknowledged. Shutting down." — leaving the
  // leader's poll waiting forever because no shutdown_response was
  // emitted via SendMessage. The addendum now teaches teammates
  // explicitly to emit structured responses; these tests lock that
  // contract so future prompt edits cannot silently regress it.

  test('teaches the shutdown_request → shutdown_response contract', () => {
    expect(TEAMMATE_SYSTEM_PROMPT_ADDENDUM).toContain('shutdown_request')
    expect(TEAMMATE_SYSTEM_PROMPT_ADDENDUM).toContain('shutdown_response')
  })

  test('shutdown_response example carries request_id from the incoming request', () => {
    // The exact echoing of request_id is the runner's join key — if
    // we lose this instruction, the runner cannot match approval to
    // request and the dedup ledger never advances.
    expect(TEAMMATE_SYSTEM_PROMPT_ADDENDUM).toMatch(
      /request_id.*from the incoming shutdown_request/,
    )
  })

  test('explicitly says plain-text acknowledgement does NOT count', () => {
    expect(TEAMMATE_SYSTEM_PROMPT_ADDENDUM).toMatch(
      /plain[- ]text.*not count|Acknowledg/i,
    )
  })

  test('teaches the plan_approval_request → plan_approval_response contract', () => {
    expect(TEAMMATE_SYSTEM_PROMPT_ADDENDUM).toContain('plan_approval_request')
    expect(TEAMMATE_SYSTEM_PROMPT_ADDENDUM).toContain('plan_approval_response')
  })

  test('warns teammate not to originate shutdown_request itself', () => {
    expect(TEAMMATE_SYSTEM_PROMPT_ADDENDUM).toMatch(/originate.*shutdown_request/i)
  })

  test('mentions REQUIRED — not optional', () => {
    // The "MUST" framing is how the model knows this is a hard
    // contract, not an aspiration. If a future edit softens it
    // ("you should consider..."), this test fails.
    expect(TEAMMATE_SYSTEM_PROMPT_ADDENDUM).toMatch(/REQUIRED|MUST/)
  })
})
