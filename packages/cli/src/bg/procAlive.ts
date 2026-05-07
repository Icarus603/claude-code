/**
 * Process-alive check with procStart verification — port of ant
 * 4643.js CX_(). Confirms `pid` is alive AND that its starttime
 * matches `expectedProcStart`. Without the procStart check, a
 * recycled PID (rare but possible after high-volume process churn)
 * would be incorrectly classified as alive.
 *
 * Returns true if alive AND procStart matches (or expectedProcStart
 * is unknown/0). Returns false if dead, unreachable (EPERM as not-us),
 * or procStart mismatched.
 *
 * @dynamicRequire
 */

import { readProcStart } from '@claude-code/daemon/bgWorkerRegistry.js'

export function procAliveSamePid(
  pid: number,
  expectedProcStart?: number,
): boolean {
  try {
    process.kill(pid, 0)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    // ESRCH = no such process; EPERM = exists but not ours (treat as not-our-job)
    if (code === 'ESRCH' || code === 'EPERM') return false
    // Other errors: assume alive
  }
  if (!expectedProcStart) return true // can't verify; assume alive
  const actual = readProcStart(pid)
  if (!actual) return true // can't read; assume alive
  return actual === expectedProcStart
}
