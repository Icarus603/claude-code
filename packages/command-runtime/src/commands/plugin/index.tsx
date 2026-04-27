import type { Command } from '../../runtime.js'

const plugin = {
  type: 'local-jsx',
  name: 'plugin',
  aliases: ['plugins', 'marketplace'],
  description: 'Manage Claude Code plugins',
  immediate: true,
  load: () => import('./plugin.js'),
} satisfies Command

export default plugin
