import * as React from 'react'
import type { LocalJSXCommandContext } from '@claude-code/command-runtime/runtime'
import { getOauthProfileFromOauthToken } from '@claude-code/provider/oauth/getOauthProfile.js'
import type { LocalJSXCommandOnDone } from '@claude-code/agent/command.js'
import {
  getClaudeAIOAuthTokens,
  isClaudeAISubscriber,
} from '@claude-code/provider/authAlias.js'
import { openBrowser } from '@claude-code/storage/browser.js'
import { logError } from '@claude-code/local-observability/log.js'
import { Login } from '@claude-code/command-runtime/commands/login/login.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<React.ReactNode | null> {
  try {
    // Check if user is already on the highest Max plan (20x)
    if (isClaudeAISubscriber()) {
      const tokens = getClaudeAIOAuthTokens()
      let isMax20x = false

      if (tokens?.subscriptionType && tokens?.rateLimitTier) {
        isMax20x =
          tokens.subscriptionType === 'max' &&
          tokens.rateLimitTier === 'default_claude_max_20x'
      } else if (tokens?.accessToken) {
        const profile = await getOauthProfileFromOauthToken(tokens.accessToken)
        isMax20x =
          profile?.organization?.organization_type === 'claude_max' &&
          profile?.organization?.rate_limit_tier === 'default_claude_max_20x'
      }

      if (isMax20x) {
        setTimeout(
          onDone,
          0,
          'You are already on the highest Max subscription plan. For additional usage, run /login to switch to an API usage-billed account.',
        )
        return null
      }
    }

    const url = 'https://claude.ai/upgrade/max'
    await openBrowser(url)

    return (
      <Login
        startingMessage={
          'Starting new login following /upgrade. Exit with Ctrl-C to use existing account.'
        }
        onDone={success => {
          context.onChangeAPIKey()
          onDone(success ? 'Login successful' : 'Login interrupted')
        }}
      />
    )
  } catch (error) {
    logError(error as Error)
    setTimeout(
      onDone,
      0,
      'Failed to open browser. Please visit https://claude.ai/upgrade/max to upgrade.',
    )
  }
  return null
}
