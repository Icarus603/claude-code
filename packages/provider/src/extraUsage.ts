import { isClaudeAISubscriber } from './authAlias.js'
import { has1mContext } from '@claude-code/agent/context.js'

export function isBilledAsExtraUsage(
  model: string | null,
  isFastMode: boolean,
  isOpus1mMerged: boolean,
): boolean {
  if (!isClaudeAISubscriber()) return false
  if (isFastMode) return true
  if (model === null || !has1mContext(model)) return false

  const m = model
    .toLowerCase()
    .replace(/\[1m\]$/, '')
    .trim()
  const isOpus = m === 'opus' || m.includes('opus-4-7') || m.includes('opus-4-6')
  const isSonnet46 = m === 'sonnet' || m.includes('sonnet-4-6')

  if (isOpus && isOpus1mMerged) return false

  return isOpus || isSonnet46
}
