import type { Command } from '@claude-code/command-runtime/runtime'

const ide = {
  type: 'local-jsx',
  name: 'ide',
  description: 'Manage IDE integrations and show status',
  argumentHint: '[open]',
  load: () => import('@claude-code/ide/ide.js'),
} satisfies Command

export default ide
