import { getIsRemoteMode } from '@claude-code/app-host/bootstrap/state.js'
import type { Command } from '@claude-code/command-runtime/runtime'

const session = {
  type: 'local-jsx',
  name: 'session',
  aliases: ['remote'],
  description: 'Show remote session URL and QR code',
  isEnabled: () => getIsRemoteMode(),
  get isHidden() {
    return !getIsRemoteMode()
  },
  load: () => import('@claude-code/command-runtime/commands/session/session.js'),
} satisfies Command

export default session
