import { getGlobalConfig, saveGlobalConfig } from '@claude-code/config'
import { ALL_LESSONS } from './lessons/index.js'

/**
 * Per-machine state for /powerup. Persisted in `globalConfig.powerupsUnlocked`.
 *
 * Stale-id tolerance: if a lesson is removed in a future ccb version, its id
 * may still sit in the user's globalConfig from a prior install. `getUnlocked`
 * filters against the live `ALL_LESSONS` set so removed ids vanish silently.
 * The denominator used by `isAllUnlocked` and the LogoV2 banner is always the
 * live count, never the persisted count.
 */

/** Set of ids the current build knows about. ALL_LESSONS is a module-level
 * constant, so this is computed once. */
const KNOWN_IDS: Set<string> = new Set(ALL_LESSONS.map(l => l.id))

export function getUnlocked(): Set<string> {
  const persisted = getGlobalConfig().powerupsUnlocked ?? []
  return new Set(persisted.filter(id => KNOWN_IDS.has(id)))
}

/**
 * Marks a lesson as unlocked. The new state is built inside the
 * `saveGlobalConfig` updater so the read-modify-write happens under the
 * write lock — matches every other `saveGlobalConfig` call site in the
 * repo and avoids a stale-read window if two callers race.
 *
 * Returning `current` unchanged when the id is already persisted lets
 * `saveGlobalConfig` skip the disk write entirely (it compares references).
 */
export function markUnlocked(id: string): void {
  saveGlobalConfig(current => {
    const persisted = current.powerupsUnlocked ?? []
    if (persisted.includes(id)) return current
    return { ...current, powerupsUnlocked: [...persisted, id] }
  })
}

export function isAllUnlocked(): boolean {
  return getUnlocked().size === ALL_LESSONS.length
}

/** Total lesson count — exported for the banner's `(X/N)` denominator. */
export function totalLessons(): number {
  return ALL_LESSONS.length
}
