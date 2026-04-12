/**
 * V7 §11.4 — lazy proper-lockfile wrapper for config's atomic config writes.
 * Duplicated from src/utils/lockfile.ts (43 lines) to avoid pulling src/ deps.
 * proper-lockfile depends on graceful-fs which monkey-patches node:fs on first
 * require; lazy loading avoids that cost on startup.
 */

type LockOptions = { stale?: number; retries?: number | { retries?: number; minTimeout?: number; maxTimeout?: number } }
type UnlockOptions = { realpath?: boolean }

let _lockfile: any

function getLockfile() {
  if (!_lockfile) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _lockfile = require('proper-lockfile')
  }
  return _lockfile
}

export function lockSync(file: string, options?: LockOptions): () => void {
  return getLockfile().lockSync(file, options)
}

export function unlock(file: string, options?: UnlockOptions): Promise<void> {
  return getLockfile().unlock(file, options)
}
