import { afterEach, describe, expect, test } from 'bun:test'
import { getClientPlatform } from '../systemConstants.js'

/**
 * Port of ant v2.1.150 `T2()` — maps CLAUDE_CODE_ENTRYPOINT to the
 * `anthropic-client-platform` header value. Server-side analytics split
 * traffic by this dimension, so a wrong mapping silently misattributes
 * usage. This pins the full switch including the `cli`/default fallthrough.
 */
describe('getClientPlatform (ant v2.1.150 T2)', () => {
  const original = process.env.CLAUDE_CODE_ENTRYPOINT

  afterEach(() => {
    if (original === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
    else process.env.CLAUDE_CODE_ENTRYPOINT = original
  })

  const cases: Array<[string, string]> = [
    ['claude-vscode', 'claude_code_vscode'],
    ['remote', 'claude_code_remote'],
    ['remote_baku', 'claude_code_remote'],
    ['remote_cowork', 'claude_code_remote'],
    ['remote_desktop', 'claude_code_remote'],
    ['remote_mobile', 'claude_code_remote'],
    ['sdk-cli', 'claude_code_sdk'],
    ['sdk-ts', 'claude_code_sdk'],
    ['sdk-py', 'claude_code_sdk'],
    ['mcp', 'claude_code_mcp'],
    ['claude-code-github-action', 'claude_code_github_action'],
    ['local-agent', 'claude_code_local_agent'],
    ['claude_in_slack', 'claude_in_slack'],
    ['cli', 'claude_code_cli'],
  ]

  for (const [entrypoint, expected] of cases) {
    test(`${entrypoint} → ${expected}`, () => {
      process.env.CLAUDE_CODE_ENTRYPOINT = entrypoint
      expect(getClientPlatform()).toBe(expected)
    })
  }

  test('unknown entrypoint falls through to claude_code_cli', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'something-unrecognized'
    expect(getClientPlatform()).toBe('claude_code_cli')
  })

  test('unset entrypoint falls through to claude_code_cli', () => {
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    expect(getClientPlatform()).toBe('claude_code_cli')
  })
})
