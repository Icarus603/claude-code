import type { Command } from '@claude-code/command-runtime/runtime'
import { isConsumerSubscriber } from '@claude-code/provider/authAlias.js'

const privacySettings = {
  type: 'local-jsx',
  name: 'privacy-settings',
  description: 'View and update your privacy settings',
  isEnabled: () => {
    return isConsumerSubscriber()
  },
  load: () => import('@claude-code/command-runtime/commands/privacy-settings/privacy-settings.js'),
} satisfies Command

export default privacySettings
