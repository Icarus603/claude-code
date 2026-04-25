import { getIsNonInteractiveSession } from '@claude-code/app-host/bootstrap/state.js'
import type { Command } from '@claude-code/command-runtime/runtime'

const command: Command = {
  name: 'chrome',
  description: 'Claude in Chrome (Beta) settings',
  availability: [],
  isEnabled: () => !getIsNonInteractiveSession(),
  type: 'local-jsx',
  load: () => import('@claude-code/command-runtime/commands/chrome/chrome.js'),
}

export default command
