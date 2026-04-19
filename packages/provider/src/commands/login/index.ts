import type { Command } from 'src/commands.js'
import { hasAnthropicApiKeyAuth } from 'src/utils/auth.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { readEnv } from '@claude-code/config/env'

export default () =>
  ({
    type: 'local-jsx',
    name: 'login',
    description: hasAnthropicApiKeyAuth()
      ? 'Switch Anthropic accounts'
      : 'Sign in with your Anthropic account',
    isEnabled: () => !isEnvTruthy(readEnv('DISABLE_LOGIN_COMMAND')),
    load: () => import('./login.js'),
  }) satisfies Command
