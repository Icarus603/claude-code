import { formatTotalCost } from '@claude-code/provider/costTracker.js'
import { currentLimits } from '@claude-code/provider/claudeAiLimits.js'
import type { LocalCommandCall } from '@claude-code/agent/command.js'
import { isClaudeAISubscriber } from '@claude-code/provider/authAlias.js'
import { readEnv } from '@claude-code/config/env/utils'

export const call: LocalCommandCall = async () => {
  if (isClaudeAISubscriber()) {
    let value: string

    if (currentLimits.isUsingOverage) {
      value =
        'You are currently using your overages to power your Claude Code usage. We will automatically switch you back to your subscription rate limits when they reset'
    } else {
      value =
        'You are currently using your subscription to power your Claude Code usage'
    }

    if (readEnv('USER_TYPE') === 'ant') {
      value += `\n\n[ANT-ONLY] Showing cost anyway:\n ${formatTotalCost()}`
    }
    return { type: 'text', value }
  }
  return { type: 'text', value: formatTotalCost() }
}
