import { isEnvTruthy } from '@claude-code/config/env/utils'

export function isScreenReaderMode(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_ACCESSIBILITY)
}
