import type { Command } from '@claude-code/command-runtime/runtime'
import { isEnvTruthy } from '@claude-code/config/env/utils'
import { readEnv } from '@claude-code/config/env'

export default {
  type: 'local-jsx',
  name: 'logout',
  // With connection-based multi-provider, /logout opens the connection
  // manager so the user can disconnect specific providers. The old "nuke
  // everything" behavior has been removed — there is no more single
  // global logout when multiple providers coexist.
  description: 'Manage connections — sign out from a specific provider',
  isEnabled: () => !isEnvTruthy(readEnv('DISABLE_LOGOUT_COMMAND')),
  load: () => import('./logout.js'),
} satisfies Command
