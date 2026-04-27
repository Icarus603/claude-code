import type { Command } from '../../runtime.js'

const skills = {
  type: 'local-jsx',
  name: 'skills',
  description: 'List available skills',
  load: () => import('./skills.js'),
} satisfies Command

export default skills
