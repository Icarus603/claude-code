import type { Command } from '@claude-code/command-runtime/runtime'

const btw = {
  type: 'local-jsx',
  name: 'btw',
  description:
    'Ask a quick side question without interrupting the main conversation',
  immediate: true,
  argumentHint: '<question>',
  load: () => import('@claude-code/command-runtime/commands/btw/btw.js'),
} satisfies Command

export default btw
