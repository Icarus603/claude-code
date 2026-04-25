import type { Command } from '@claude-code/command-runtime/runtime'
import { shouldInferenceConfigCommandBeImmediate } from '@claude-code/shell/immediateCommand.js'

export default {
  type: 'local-jsx',
  name: 'effort',
  description: 'Set effort level for model usage',
  argumentHint: '[low|medium|high|max|auto]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('@claude-code/command-runtime/commands/effort/effort.js'),
} satisfies Command
