import type { Command } from '@claude-code/command-runtime/runtime'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { readEnv } from '@claude-code/config/env/utils'

const compact = {
  type: 'local',
  name: 'compact',
  description:
    'Clear conversation history but keep a summary in context. Optional: /compact [instructions for summarization]',
  isEnabled: () => !isEnvTruthy(readEnv('DISABLE_COMPACT')),
  supportsNonInteractive: true,
  argumentHint: '<optional custom summarization instructions>',
  load: () => import('@claude-code/command-runtime/commands/compact/compact.js'),
} satisfies Command

export default compact
