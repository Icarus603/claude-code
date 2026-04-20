import capitalize from 'lodash-es/capitalize.js'
import type { SettingSource } from '@claude-code/config/constants'
import { getSettingSourceName } from '@claude-code/config/constants'

export function getAgentSourceDisplayName(
  source: SettingSource | 'all' | 'built-in' | 'plugin',
): string {
  if (source === 'all') {
    return 'Agents'
  }
  if (source === 'built-in') {
    return 'Built-in agents'
  }
  if (source === 'plugin') {
    return 'Plugin agents'
  }
  return capitalize(getSettingSourceName(source))
}
