import { getIsNonInteractiveSession } from '@claude-code/app-host/bootstrap/state.js'
import type { Command } from '@claude-code/command-runtime/runtime'
import { isOverageProvisioningAllowed } from '@claude-code/provider/authAlias.js'
import { isEnvTruthy } from '@claude-code/config/env/utils'

function isExtraUsageAllowed(): boolean {
  if (isEnvTruthy(process.env.DISABLE_EXTRA_USAGE_COMMAND)) {
    return false
  }
  return isOverageProvisioningAllowed()
}

export const extraUsage = {
  type: 'local-jsx',
  name: 'extra-usage',
  description: 'Configure extra usage to keep working when limits are hit',
  isEnabled: () => isExtraUsageAllowed() && !getIsNonInteractiveSession(),
  load: () => import('@claude-code/command-runtime/commands/extra-usage/extra-usage.js'),
} satisfies Command

export const extraUsageNonInteractive = {
  type: 'local',
  name: 'extra-usage',
  supportsNonInteractive: true,
  description: 'Configure extra usage to keep working when limits are hit',
  isEnabled: () => isExtraUsageAllowed() && getIsNonInteractiveSession(),
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  load: () => import('@claude-code/command-runtime/commands/extra-usage/extra-usage-noninteractive.js'),
} satisfies Command
