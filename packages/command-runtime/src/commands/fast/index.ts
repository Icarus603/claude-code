import type { Command } from '@claude-code/command-runtime/runtime'
import {
  FAST_MODE_MODEL_DISPLAY,
  isFastModeEnabled,
} from '@claude-code/provider/fastMode.js'
import { shouldInferenceConfigCommandBeImmediate } from '@claude-code/shell/immediateCommand.js'

const fast = {
  type: 'local-jsx',
  name: 'fast',
  get description() {
    return `Toggle fast mode (${FAST_MODE_MODEL_DISPLAY} only)`
  },
  availability: ['claude-ai', 'console'],
  isEnabled: () => isFastModeEnabled(),
  get isHidden() {
    return !isFastModeEnabled()
  },
  argumentHint: '[on|off]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('@claude-code/command-runtime/commands/fast/fast.js'),
} satisfies Command

export default fast
