import type { Command } from '../../runtime.js'
import { getSubscriptionType } from '@claude-code/provider/authAlias.js'
import { isEnvTruthy } from '@claude-code/config/env/utils'
import { readEnv } from '@claude-code/config/env/utils'

const upgrade = {
  type: 'local-jsx',
  name: 'upgrade',
  description: 'Upgrade to Max for higher rate limits and more Opus',
  availability: ['claude-ai'],
  isEnabled: () =>
    !isEnvTruthy(readEnv('DISABLE_UPGRADE_COMMAND')) &&
    getSubscriptionType() !== 'enterprise',
  load: () => import('./upgrade.js'),
} satisfies Command

export default upgrade
