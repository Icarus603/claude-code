// Slim "/dream last-ran" tracker — used purely by the /memory UI to show
// "last ran X ago" (and by `/dream consolidate` to refresh that mtime).
//
// History: ccb originally used a fuller cross-process lock (acquire/rollback)
// to gate stop-hook autoDream firings. Stop-hook autoDream was deleted when
// /dream switched to cron-driven scheduling (KAIROS subsystem 1). Upstream
// v2.1.123 kept just these two functions for the same UI reason; ccb now
// matches upstream — only `recordConsolidation` (write mtime) and
// `readLastConsolidatedAt` (read mtime) survive. The `.consolidate-lock`
// filename is preserved so users upgrading from a pre-KAIROS ccb retain
// their last-ran timestamp.

import { mkdir, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { getMemoryHostBindings } from './host.js'
import { getAutoMemPath } from './paths.js'

const LOCK_FILE = '.consolidate-lock'

function lockPath(): string {
  return join(getAutoMemPath(), LOCK_FILE)
}

export async function readLastConsolidatedAt(): Promise<number> {
  try {
    const s = await stat(lockPath())
    return s.mtimeMs
  } catch {
    return 0
  }
}

export async function recordConsolidation(): Promise<void> {
  const bindings = getMemoryHostBindings()
  try {
    await mkdir(getAutoMemPath(), { recursive: true })
    await writeFile(lockPath(), String(process.pid))
  } catch (e: unknown) {
    bindings.logDebug?.(
      `[dream] recordConsolidation write failed: ${(e as Error).message}`,
    )
  }
}
