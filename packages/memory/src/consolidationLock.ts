import { mkdir, readFile, stat, unlink, utimes, writeFile } from 'fs/promises'
import { join } from 'path'
import { getMemoryHostBindings } from './host.js'
import { getAutoMemPath } from './paths.js'

const LOCK_FILE = '.consolidate-lock'
const HOLDER_STALE_MS = 60 * 60 * 1000

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

export async function tryAcquireConsolidationLock(): Promise<number | null> {
  const path = lockPath()
  const bindings = getMemoryHostBindings()

  let mtimeMs: number | undefined
  let holderPid: number | undefined
  try {
    const [s, raw] = await Promise.all([stat(path), readFile(path, 'utf8')])
    mtimeMs = s.mtimeMs
    const parsed = parseInt(raw.trim(), 10)
    holderPid = Number.isFinite(parsed) ? parsed : undefined
  } catch {
    // No prior lock.
  }

  if (mtimeMs !== undefined && Date.now() - mtimeMs < HOLDER_STALE_MS) {
    if (holderPid !== undefined && bindings.isProcessRunning?.(holderPid)) {
      bindings.logDebug?.(
        `[autoDream] lock held by live PID ${holderPid} (mtime ${Math.round((Date.now() - mtimeMs) / 1000)}s ago)`,
      )
      return null
    }
  }

  await mkdir(getAutoMemPath(), { recursive: true })
  await writeFile(path, String(process.pid))

  let verify: string
  try {
    verify = await readFile(path, 'utf8')
  } catch {
    return null
  }
  if (parseInt(verify.trim(), 10) !== process.pid) return null

  return mtimeMs ?? 0
}

export async function rollbackConsolidationLock(
  priorMtime: number,
): Promise<void> {
  const path = lockPath()
  const bindings = getMemoryHostBindings()
  try {
    if (priorMtime === 0) {
      await unlink(path)
      return
    }
    await writeFile(path, '')
    const t = priorMtime / 1000
    await utimes(path, t, t)
  } catch (e: unknown) {
    bindings.logDebug?.(
      `[autoDream] rollback failed: ${(e as Error).message} — next trigger delayed to minHours`,
    )
  }
}

export async function listSessionsTouchedSince(
  sinceMs: number,
): Promise<string[]> {
  const bindings = getMemoryHostBindings()
  const originalCwd = bindings.getOriginalCwd?.() ?? process.cwd()
  const dir = bindings.getProjectDir?.(originalCwd) ?? originalCwd
  const candidates = await (bindings.listCandidates?.(dir, true) ?? Promise.resolve([]))
  return candidates.filter(c => c.mtime > sinceMs).map(c => c.sessionId)
}

export async function recordConsolidation(): Promise<void> {
  const bindings = getMemoryHostBindings()
  try {
    await mkdir(getAutoMemPath(), { recursive: true })
    await writeFile(lockPath(), String(process.pid))
  } catch (e: unknown) {
    bindings.logDebug?.(
      `[autoDream] recordConsolidation write failed: ${(e as Error).message}`,
    )
  }
}
