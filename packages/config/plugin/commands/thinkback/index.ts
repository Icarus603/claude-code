import type { Command } from '@claude-code/command-runtime/runtime'
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from '../../../feature-flags.js'

const thinkback = {
  type: 'local-jsx',
  name: 'think-back',
  description: 'Your 2025 Claude Code Year in Review',
  isEnabled: () =>
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_thinkback'),
  load: () => import('./thinkback.js'),
} satisfies Command

export default thinkback
