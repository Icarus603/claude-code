import type { Command } from '../../runtime.js'

const memory: Command = {
  type: 'local-jsx',
  name: 'memory',
  description: 'Edit Claude memory files',
  load: () => import('./memory.js'),
}

export default memory
