// Compatibility shim for Phase 3. Scheduler lock implementation ownership now
// lives in @claude-code/agent/scheduler; remove this shim once src/* callers
// finish migrating to the package surface.

export type { SchedulerLockOptions } from '@claude-code/agent/scheduler'

export {
  releaseSchedulerLock,
  tryAcquireSchedulerLock,
} from '@claude-code/agent/scheduler'
