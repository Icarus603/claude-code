import { useRef } from 'react'
import { major, minor, patch } from 'semver'

export function getSemverPart(version: string): string {
  return `${major(version, { loose: true })}.${minor(version, { loose: true })}.${patch(version, { loose: true })}`
}

export function shouldShowUpdateNotification(
  updatedVersion: string,
  lastNotifiedSemver: string | null,
): boolean {
  const updatedSemver = getSemverPart(updatedVersion)
  return updatedSemver !== lastNotifiedSemver
}

// The dedup memory must live in a ref, not useState. Calling setState during
// render causes React to throw away that render and immediately re-run; the
// re-run sees the just-updated state and the condition fails, so the hook
// returns null on the only render where it should have returned the new
// semver. Net effect with the prior useState implementation: the
// "✓ Update installed" notification never visibly mounted, even though the
// underlying installer succeeded. A ref mutates synchronously without
// retriggering render, so the first render after `updatedVersion` flips
// returns the new semver and commits.
export function useUpdateNotification(
  updatedVersion: string | null | undefined,
  initialVersion: string = MACRO.VERSION,
): string | null {
  const lastNotifiedSemverRef = useRef<string>(getSemverPart(initialVersion))

  if (!updatedVersion) {
    return null
  }

  const updatedSemver = getSemverPart(updatedVersion)
  if (updatedSemver === lastNotifiedSemverRef.current) {
    return null
  }
  lastNotifiedSemverRef.current = updatedSemver
  return updatedSemver
}
