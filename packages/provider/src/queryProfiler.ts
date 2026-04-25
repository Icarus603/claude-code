import { getPerformance } from '@claude-code/app-host/startup/profilerBase.js'
import { isEnvTruthy, readEnv } from '@claude-code/config/env/utils'

const ENABLED = isEnvTruthy(readEnv('CLAUDE_CODE_PROFILE_QUERY'))
let queryCount = 0

export function startQueryProfile(): void {
  if (!ENABLED) return

  const perf = getPerformance()
  perf.clearMarks()
  queryCount++
  queryCheckpoint('query_user_input_received')
}

export function queryCheckpoint(name: string): void {
  if (!ENABLED) return

  getPerformance().mark(name)
}

export function endQueryProfile(): void {
  if (!ENABLED) return

  queryCheckpoint('query_profile_end')
}

export function logQueryProfileReport(): void {
  if (!ENABLED) return
  void queryCount
}
