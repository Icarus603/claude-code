import type { Command } from '@claude-code/command-runtime/runtime'

const tasks = {
  type: 'local-jsx',
  name: 'tasks',
  aliases: ['bashes'],
  description: 'List and manage background tasks',
  load: () => import('./tasks.js'),
} satisfies Command

export default tasks
