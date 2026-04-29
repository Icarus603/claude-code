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
