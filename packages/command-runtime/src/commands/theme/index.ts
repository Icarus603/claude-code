import type { Command } from '@claude-code/command-runtime/runtime'

const theme = {
  type: 'local-jsx',
  name: 'theme',
  description: 'Change the theme',
  load: () => import('@claude-code/command-runtime/commands/theme/theme.js'),
} satisfies Command

export default theme
