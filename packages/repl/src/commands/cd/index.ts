import type { Command } from '@claude-code/command-runtime/runtime'

const cd = {
  type: 'local',
  name: 'cd',
  description: 'Change the session working directory',
  argumentHint: '<path>',
  supportsNonInteractive: true,
  load: () => import('./cd.js'),
} satisfies Command

export default cd
