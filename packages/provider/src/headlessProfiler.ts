import { getIsNonInteractiveSession } from '@claude-code/app-host/bootstrap/state.js'
import { getPerformance } from '@claude-code/app-host/startup/profilerBase.js'
import { isEnvTruthy, readEnv } from '@claude-code/config/env/utils'

const DETAILED_PROFILING = isEnvTruthy(readEnv('CLAUDE_CODE_PROFILE_STARTUP'))
const STATSIG_SAMPLE_RATE = 0.05
const STATSIG_LOGGING_SAMPLED =
  readEnv('USER_TYPE') === 'ant' || Math.random() < STATSIG_SAMPLE_RATE
const SHOULD_PROFILE = DETAILED_PROFILING || STATSIG_LOGGING_SAMPLED
const MARK_PREFIX = 'headless_'
let currentTurnNumber = -1

export function headlessProfilerStartTurn(): void {
  if (!getIsNonInteractiveSession()) return
  if (!SHOULD_PROFILE) return

  currentTurnNumber++
  const perf = getPerformance()
  for (const mark of perf.getEntriesByType('mark')) {
    if (mark.name.startsWith(MARK_PREFIX)) {
      perf.clearMarks(mark.name)
    }
  }
  perf.mark(`${MARK_PREFIX}turn_start`)
}

export function headlessProfilerCheckpoint(name: string): void {
  if (!getIsNonInteractiveSession()) return
  if (!SHOULD_PROFILE) return

  getPerformance().mark(`${MARK_PREFIX}${name}`)
}

export function logHeadlessProfilerTurn(): void {
  if (!getIsNonInteractiveSession()) return
  if (!SHOULD_PROFILE) return
  void currentTurnNumber
}
