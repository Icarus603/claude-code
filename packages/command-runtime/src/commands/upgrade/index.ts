import type { Command } from '@claude-code/command-runtime/runtime'
import { getSubscriptionType } from '@claude-code/provider/authAlias.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { readEnv } from '@claude-code/config/env/utils'

const upgrade = {
  type: 'local-jsx',
  name: 'upgrade',
  description: 'Upgrade to Max for higher rate limits and more Opus',
  availability: ['claude-ai'],
  isEnabled: () =>
    !isEnvTruthy(readEnv('DISABLE_UPGRADE_COMMAND')) &&
    getSubscriptionType() !== 'enterprise',
  load: () => import('@claude-code/command-runtime/commands/upgrade/upgrade.js'),
} satisfies Command

export default upgrade
