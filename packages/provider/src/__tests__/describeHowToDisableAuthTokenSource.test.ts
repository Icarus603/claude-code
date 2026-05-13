import { describe, expect, test } from 'bun:test'

import { describeHowToDisableAuthTokenSource } from '../authAlias.js'

/**
 * Byte-for-byte alignment vs ant gt6 (1997.js).
 *
 * The status-notice UI ("Trying to use {apiKeySource}? {how-to-disable-token}")
 * relies on the exact strings produced here. Two cases used to be hard-coded
 * inline as a ternary in statusNoticeDefinitions.tsx; the rest fell through
 * to a generic "Unset the {source} environment variable" message which was
 * WRONG for sources that aren't env vars (CCR_OAUTH_TOKEN_FILE is injected
 * by a host process; apiKeyHelper is a settings.json field).
 */
describe('describeHowToDisableAuthTokenSource (ant gt6 parity)', () => {
  test('claude.ai → /logout instruction', () => {
    expect(describeHowToDisableAuthTokenSource('claude.ai')).toBe(
      'claude /logout to sign out of claude.ai.',
    )
  })

  test('apiKeyHelper → settings (not env) hint', () => {
    expect(describeHowToDisableAuthTokenSource('apiKeyHelper')).toBe(
      'Unset the apiKeyHelper setting.',
    )
  })

  test('CCR_OAUTH_TOKEN_FILE → CCR host hint (NOT an env-var unset message)', () => {
    const out = describeHowToDisableAuthTokenSource('CCR_OAUTH_TOKEN_FILE')
    expect(out).toBe(
      'This token is injected by the CCR host; check the host session.',
    )
    // Defensive: we must never tell the user to "unset" CCR_OAUTH_TOKEN_FILE
    // because it isn't a process env var — it's read from a fd or disk file
    // injected by the CCR host. Outputting "Unset the CCR_OAUTH_TOKEN_FILE
    // environment variable" would be misleading.
    expect(out).not.toContain('environment variable')
  })

  test('none → empty string', () => {
    expect(describeHowToDisableAuthTokenSource('none')).toBe('')
  })

  test.each([
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  ])('%s → generic env-var unset message', source => {
    expect(describeHowToDisableAuthTokenSource(source)).toBe(
      `Unset the ${source} environment variable.`,
    )
  })
})
