import { getIsNonInteractiveSession } from '@claude-code/app-host/bootstrap/state.js'
import type { Command } from '@claude-code/command-runtime/runtime'

export const context: Command = {
  name: 'context',
  description: 'Visualize current context usage as a colored grid',
  isEnabled: () => !getIsNonInteractiveSession(),
  type: 'local-jsx',
  load: () => import('@claude-code/command-runtime/commands/context/context.js'),
}

export const contextNonInteractive: Command = {
  type: 'local',
  name: 'context',
  supportsNonInteractive: true,
  description: 'Show current context usage',
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  isEnabled() {
    return getIsNonInteractiveSession()
  },
  load: () => import('@claude-code/command-runtime/commands/context/context-noninteractive.js'),
}
