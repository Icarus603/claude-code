import type { Command } from '@claude-code/command-runtime/runtime'
import { isEnvTruthy } from '@claude-code/config/env/utils'
import { readEnv } from '@claude-code/config/env'

export default {
  type: 'local-jsx',
  name: 'logout',
  // With multi-provider connections coexisting, /logout disconnects a
  // specific connection: directly when there is only one, via a
  // disconnect-only picker when there are several. /login owns the
  // "manage connections" surface (add / enable / disable).
  description: 'Sign out of a connection',
  isEnabled: () => !isEnvTruthy(readEnv('DISABLE_LOGOUT_COMMAND')),
  load: () => import('./logout.js'),
} satisfies Command
