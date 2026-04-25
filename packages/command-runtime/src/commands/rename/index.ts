import type { Command } from '@claude-code/command-runtime/runtime'

const rename = {
  type: 'local-jsx',
  name: 'rename',
  description: 'Rename the current conversation',
  immediate: true,
  argumentHint: '[name]',
  load: () => import('@claude-code/command-runtime/commands/rename/rename.js'),
} satisfies Command

export default rename
