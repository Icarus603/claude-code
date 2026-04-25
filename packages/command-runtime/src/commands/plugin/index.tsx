import type { Command } from '@claude-code/command-runtime/runtime'

const plugin = {
  type: 'local-jsx',
  name: 'plugin',
  aliases: ['plugins', 'marketplace'],
  description: 'Manage Claude Code plugins',
  immediate: true,
  load: () => import('@claude-code/command-runtime/commands/plugin/plugin.js'),
} satisfies Command

export default plugin
