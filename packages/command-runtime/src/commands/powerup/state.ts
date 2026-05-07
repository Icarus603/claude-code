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
function knownIds(): Set<string> {
  return new Set(ALL_LESSONS.map(l => l.id))
}

export function getUnlocked(): Set<string> {
  const persisted = getGlobalConfig().powerupsUnlocked ?? []
  const known = knownIds()
  return new Set(persisted.filter(id => known.has(id)))
}

export function markUnlocked(id: string): void {
  const next = new Set(getUnlocked())
  if (next.has(id)) return
  next.add(id)
  saveGlobalConfig(current => ({
    ...current,
    powerupsUnlocked: [...next],
  }))
}

export function isAllUnlocked(): boolean {
  return getUnlocked().size === ALL_LESSONS.length
}

/** Total lesson count — exported for the banner's `(X/N)` denominator. */
export function totalLessons(): number {
  return ALL_LESSONS.length
}
