import type { Command } from '@claude-code/command-runtime/runtime'

const memory: Command = {
  type: 'local-jsx',
  name: 'memory',
  description: 'Edit Claude memory files',
  load: () => import('@claude-code/command-runtime/commands/memory/memory.js'),
}

export default memory
