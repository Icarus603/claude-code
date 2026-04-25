import type { Command } from '@claude-code/command-runtime/runtime'
import { isPolicyAllowed } from '@claude-code/provider/policyLimits/index.js'
import { isClaudeAISubscriber } from '@claude-code/provider/authAlias.js'

export default {
  type: 'local-jsx',
  name: 'remote-env',
  description: 'Configure the default remote environment for teleport sessions',
  isEnabled: () =>
    isClaudeAISubscriber() && isPolicyAllowed('allow_remote_sessions'),
  get isHidden() {
    return !isClaudeAISubscriber() || !isPolicyAllowed('allow_remote_sessions')
  },
  load: () => import('@claude-code/command-runtime/commands/remote-env/remote-env.js'),
} satisfies Command
