export type { CronFields } from './internal/cronCore.js'
export {
  cronToHuman,
  computeNextCronRun,
  parseCronExpression,
} from './internal/cronCore.js'

export type {
  CronJitterConfig,
  CronTask,
} from './internal/cronTasksCore.js'
export { DEFAULT_CRON_JITTER_CONFIG } from './internal/cronTasksCore.js'
export {
  addCronTask,
  findMissedTasks,
  getCronFilePath,
  hasCronTasksSync,
  jitteredNextCronRunMs,
  listAllCronTasks,
  markCronTasksFired,
  nextCronRunMs,
  oneShotJitteredNextCronRunMs,
  readCronTasks,
  removeCronTasks,
  writeCronTasks,
} from './internal/cronTasksCore.js'

export type { SchedulerLockOptions } from './internal/cronTasksLockCore.js'
export {
  releaseSchedulerLock,
  tryAcquireSchedulerLock,
} from './internal/cronTasksLockCore.js'

export type { CronScheduler } from './internal/cronSchedulerCore.js'
export { createCronScheduler } from './internal/cronSchedulerCore.js'

// LoopDynamic + sentinel resolution — KAIROS subsystem 4. Re-exported
// from this facade so cross-package callers don't violate V7 §11.2's
// no-cross-package-/internal/-import rule.
export type { ScheduleResult } from './internal/loopDynamicCore.js'
export {
  cancelAllPendingLoopSessionCrons,
  isLoopDynamicEnabled,
  MAX_LOOP_DELAY_SECONDS,
  MIN_LOOP_DELAY_SECONDS,
  scheduleLoopWakeup,
} from './internal/loopDynamicCore.js'

export {
  AUTONOMOUS_LOOP_DYNAMIC_SENTINEL,
  AUTONOMOUS_LOOP_PREAMBLE,
  AUTONOMOUS_LOOP_SENTINEL,
  isAutonomousLoopSentinel,
  isLoopDefaultPromptEnabled,
  isLoopDefaultSentinel,
  isLoopFileSentinel,
  LOOP_FILE_DYNAMIC_SENTINEL,
  LOOP_FILE_SENTINEL,
  readLoopFile,
  resetAutonomousLoopDelivered,
  resolveAutonomousLoopFire,
  resolveLoopDefaultFire,
  resolveLoopFileFire,
} from './internal/loopSentinelCore.js'
