import type { Command } from '../../runtime.js'

const powerup = {
  type: 'local-jsx',
  name: 'powerup',
  description: 'Discover ccb features through quick interactive lessons',
  load: () => import('./powerup.js'),
} satisfies Command

export default powerup
