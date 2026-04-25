import { feature } from 'bun:bundle'
import { isBridgeEnabled } from '@claude-code/bridge/bridgeEnabled.js'
import type { Command } from '@claude-code/command-runtime/runtime'

function isEnabled(): boolean {
  if (!feature('DAEMON') || !feature('BRIDGE_MODE')) {
    return false
  }
  return isBridgeEnabled()
}

const remoteControlServer = {
  type: 'local-jsx',
  name: 'remote-control-server',
  aliases: ['rcs'],
  description:
    'Start a persistent Remote Control server (daemon) that accepts multiple sessions',
  isEnabled,
  get isHidden() {
    return !isEnabled()
  },
  immediate: true,
  load: () => import('@claude-code/command-runtime/commands/remoteControlServer/remoteControlServer.js'),
} satisfies Command

export default remoteControlServer
