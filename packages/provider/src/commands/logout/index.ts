import type { Command } from '@claude-code/command-runtime/runtime'
import { isEnvTruthy } from '@claude-code/config/env/utils'
import { readEnv } from '@claude-code/config/env'

export default {
  type: 'local-jsx',
  name: 'logout',
  description: 'Sign out from your Anthropic account',
  isEnabled: () => !isEnvTruthy(readEnv('DISABLE_LOGOUT_COMMAND')),
  load: () => import('./logout.js'),
} satisfies Command
