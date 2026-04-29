import { describe, expect, test } from 'bun:test'
import { sdkCompatToolName } from '../messages/systemInit.js'
import {
  AGENT_TOOL_NAME,
  LEGACY_AGENT_TOOL_NAME,
} from '@claude-code/tool-registry/tools/AgentTool/constants.js'

describe('sdkCompatToolName — backwards-compat tool-name translation', () => {
  // Why this matters: the wire format renamed Task → Agent in #19647.
  // Emitting the new name on init/result events broke older SDK consumers
  // on a patch release. The fix is to keep emitting 'Task' for SDK
  // consumers until next-minor. This test locks down the contract so
  // a future cleanup doesn't accidentally remove the translation.

  test('returns LEGACY_AGENT_TOOL_NAME when input matches AGENT_TOOL_NAME', () => {
    expect(sdkCompatToolName(AGENT_TOOL_NAME)).toBe(LEGACY_AGENT_TOOL_NAME)
  })

  test('AGENT_TOOL_NAME and LEGACY_AGENT_TOOL_NAME differ', () => {
    // If someone sets the constants equal in a future cleanup, the
    // translation becomes a no-op and downstream SDK consumers still
    // think they're getting the new name. This is the canary.
    expect(AGENT_TOOL_NAME).not.toBe(LEGACY_AGENT_TOOL_NAME)
  })

  test('returns input unchanged when it does NOT match AGENT_TOOL_NAME', () => {
    expect(sdkCompatToolName('Bash')).toBe('Bash')
    expect(sdkCompatToolName('FileRead')).toBe('FileRead')
    expect(sdkCompatToolName('Edit')).toBe('Edit')
  })

  test('returns LEGACY_AGENT_TOOL_NAME unchanged (no double-translation)', () => {
    // If a caller already passes the legacy name (Task), it stays Task.
    // A naive "swap" implementation might translate it back to Agent.
    expect(sdkCompatToolName(LEGACY_AGENT_TOOL_NAME)).toBe(
      LEGACY_AGENT_TOOL_NAME,
    )
  })

  test('case-sensitive: lowercased name does NOT trigger translation', () => {
    // Tool names are PascalCase; lowercase variants are not real.
    // Verifying we don't case-fold protects against silent misroutes.
    expect(sdkCompatToolName('agent')).toBe('agent')
    expect(sdkCompatToolName('AGENT')).toBe('AGENT')
  })

  test('empty string returns empty string', () => {
    expect(sdkCompatToolName('')).toBe('')
  })

  test('whitespace-padded name does NOT match (exact match only)', () => {
    expect(sdkCompatToolName(` ${AGENT_TOOL_NAME}`)).toBe(` ${AGENT_TOOL_NAME}`)
    expect(sdkCompatToolName(`${AGENT_TOOL_NAME} `)).toBe(`${AGENT_TOOL_NAME} `)
  })

  test('partial match does NOT trigger translation', () => {
    // The translation must be a strict equality check, not a substring
    // contains. Otherwise "AgentTool" or "MyAgent" would get rewritten.
    expect(sdkCompatToolName(`${AGENT_TOOL_NAME}Tool`)).not.toBe(
      LEGACY_AGENT_TOOL_NAME,
    )
    expect(sdkCompatToolName(`Old${AGENT_TOOL_NAME}`)).not.toBe(
      LEGACY_AGENT_TOOL_NAME,
    )
  })
})
