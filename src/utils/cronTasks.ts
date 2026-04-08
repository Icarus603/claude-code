// Compatibility shim for Phase 3. Scheduled-task implementation ownership now
// lives in @claude-code/agent/scheduler; remove this shim once src/* callers
// finish migrating to the package surface.

export type {
  CronJitterConfig,
  CronTask,
} from '@claude-code/agent/scheduler'

export { DEFAULT_CRON_JITTER_CONFIG } from '@claude-code/agent/scheduler'

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
} from '@claude-code/agent/scheduler'
