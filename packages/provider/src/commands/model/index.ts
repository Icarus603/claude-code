import type { Command } from '@claude-code/command-runtime/runtime'
import { shouldInferenceConfigCommandBeImmediate } from '@claude-code/shell/immediateCommand.js'
import { getMainLoopModel, renderModelName } from '@claude-code/provider/model.js'

export default {
  type: 'local-jsx',
  name: 'model',
  get description() {
    return `Set the AI model for Claude Code (currently ${renderModelName(getMainLoopModel())})`
  },
  argumentHint: '[model]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./model.js'),
} satisfies Command
