/**
 * Tests for the swarm-guidance bullet in
 * `getSessionSpecificGuidanceSection`. The bullet is conditionally
 * injected based on `enabledTools.has(TEAM_CREATE_TOOL_NAME)` so
 * external builds without swarm tools don't pay a prompt-cache
 * fragmentation cost for an unreachable workflow. This test locks
 * that condition + the must-include keywords so a refactor of the
 * surrounding section doesn't silently break the guidance.
 *
 * Why this matters: a previous regression had the model silently
 * ignore swarm because the guidance lived in deferred-tool
 * description (invisible until ToolSearch loaded the schema). The
 * bullet is the ONLY spot the model learns the 7-step workflow on
 * turn 1, so its presence under the right conditions is contractual.
 */
import { describe, expect, test } from 'bun:test'

import { getSessionSpecificGuidanceSection } from '../prompts.js'

const TEAM_CREATE = 'TeamCreate'
const ASK_USER_QUESTION = 'AskUserQuestion'

describe('getSessionSpecificGuidanceSection — swarm bullet gating', () => {
  test('includes swarm guidance when TeamCreate is enabled', () => {
    const text = getSessionSpecificGuidanceSection(
      new Set<string>([TEAM_CREATE]),
      [],
    )
    expect(text).not.toBeNull()
    // Must mention the gateway tools so the model wires them up.
    expect(text!).toContain('TeamCreate')
    expect(text!).toContain('TaskCreate')
    expect(text!).toContain('SendMessage')
    // Must mention dependency-graph wiring (Phase E2).
    expect(text!).toContain('blockedBy')
    // Must mention exactly-once delivery so the model trusts retries.
    expect(text!).toMatch(/exactly[- ]once/i)
    // Must call out the key failure mode (parallel = same message).
    expect(text!).toMatch(/single message/i)
  })

  test('omits swarm guidance when TeamCreate is NOT enabled', () => {
    const text = getSessionSpecificGuidanceSection(
      new Set<string>([ASK_USER_QUESTION]),
      [],
    )
    // Could be null or have other bullets — the swarm bullet must
    // not appear, otherwise external builds eat a cache fragment for
    // a workflow they cannot use.
    if (text !== null) {
      expect(text).not.toContain('TeamCreate')
      expect(text).not.toContain('blockedBy')
    }
  })

  test('with empty enabledTools, no swarm guidance', () => {
    const text = getSessionSpecificGuidanceSection(new Set<string>(), [])
    if (text !== null) {
      expect(text).not.toContain('TeamCreate')
    }
  })

  test('swarm guidance bullet sits inside the Session-specific guidance section', () => {
    // If the bullet escapes its parent section the cache fragment
    // calculus changes — fail loud.
    const text = getSessionSpecificGuidanceSection(
      new Set<string>([TEAM_CREATE]),
      [],
    )
    expect(text!.startsWith('# Session-specific guidance')).toBe(true)
  })

  test('bullet mentions ToolSearch to bootstrap deferred schemas', () => {
    // The whole point of this guidance is that swarm tools are
    // deferred (invisible without ToolSearch). If we forget to
    // mention ToolSearch the model still does not know to load the
    // schemas — guidance becomes useless.
    const text = getSessionSpecificGuidanceSection(
      new Set<string>([TEAM_CREATE]),
      [],
    )
    expect(text!).toContain('ToolSearch')
  })
})
