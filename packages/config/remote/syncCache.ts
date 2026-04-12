/**
 * Eligibility check for remote managed settings.
 *
 * The cache state itself lives in syncCacheState.ts (a leaf, no auth import).
 * This file keeps isRemoteManagedSettingsEligible — the one function that
 * needs auth/provider state — plus resetSyncCache wrapped to clear the local
 * eligibility mirror alongside the leaf's state.
 *
 * V7 §8.6: config cannot import from provider/auth (Wave 3 domain core).
 * The full eligibility logic is injected via ConfigHostBindings.
 * checkRemoteSettingsEligibility, installed by the app-host at composition
 * time. Config only calls it and caches the result.
 */

import { getConfigHostBindings } from '../host.js'
import {
  resetSyncCache as resetLeafCache,
  setEligibility,
} from './syncCacheState.js'

let cached: boolean | undefined

export function resetSyncCache(): void {
  cached = undefined
  resetLeafCache()
}

/**
 * Check if the current user is eligible for remote managed settings.
 *
 * Delegates to the host binding (which checks OAuth tokens, API key,
 * provider type, base URL, entrypoint) and caches the result.
 */
export function isRemoteManagedSettingsEligible(): boolean {
  if (cached !== undefined) return cached

  const check = getConfigHostBindings().checkRemoteSettingsEligibility
  if (!check) {
    // Host binding not installed (early bootstrap, tests, or headless runs
    // that skip remote settings). Conservative: not eligible.
    return (cached = setEligibility(false))
  }

  return (cached = setEligibility(check()))
}
